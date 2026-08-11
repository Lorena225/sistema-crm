-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 2: auditoria generica append-only
--
-- audit_log_entries recebe acoes de todos os modulos futuros, entao o
-- esquema e deliberadamente generico: resource_type/resource_id em vez de
-- uma FK por entidade, e before_state/after_state em jsonb.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enum de ator
-- ---------------------------------------------------------------------
create type public.audit_actor_type as enum (
  'user', 'ai_agent', 'automation', 'reseller_admin', 'system'
);

-- ---------------------------------------------------------------------
-- 2. Tabela
-- ---------------------------------------------------------------------
create table public.audit_log_entries (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  actor_type    public.audit_actor_type not null,
  actor_id      uuid,
  action        text not null check (length(btrim(action)) between 1 and 120),
  resource_type text not null check (length(btrim(resource_type)) between 1 and 80),
  resource_id   uuid,
  before_state  jsonb,
  after_state   jsonb,
  ip_address    inet,
  created_at    timestamptz not null default now()
);

comment on table public.audit_log_entries is 'Trilha de auditoria append-only. Nenhuma interface pode alterar ou apagar registros. Esquema generico: recebe acoes de todos os modulos futuros.';
comment on column public.audit_log_entries.workspace_id is 'Sem FK para workspaces de proposito: a trilha precisa sobreviver a exclusao do tenant. Ver ADR-0008.';
comment on column public.audit_log_entries.actor_id is 'Nulo quando actor_type = system (job agendado, migration, gatilho sem sessao).';

-- ---------------------------------------------------------------------
-- 3. Indices
-- ---------------------------------------------------------------------
create index audit_log_entries_workspace_id_idx on public.audit_log_entries (workspace_id);
-- Consulta dominante: ultimos eventos de um workspace.
create index audit_log_entries_workspace_created_idx
  on public.audit_log_entries (workspace_id, created_at desc);
-- Historico de um recurso especifico ("o que aconteceu com este negocio?").
create index audit_log_entries_resource_idx
  on public.audit_log_entries (workspace_id, resource_type, resource_id);
create index audit_log_entries_actor_idx
  on public.audit_log_entries (workspace_id, actor_type, actor_id);

-- before_state/after_state nao recebem indice GIN nesta etapa: sao payloads
-- de leitura, nao criterio de filtro. O indice entra quando existir consulta
-- que filtre por dentro do jsonb.

-- ---------------------------------------------------------------------
-- 4. Append-only: bloqueio no nivel do banco
-- ---------------------------------------------------------------------
-- RLS sozinha nao basta: service_role tem BYPASSRLS. O gatilho abaixo vale
-- para qualquer papel, inclusive o dono da tabela e rotas administrativas.
create or replace function app.prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log_entries e append-only: % nao e permitido', tg_op
    using errcode = '42501';
end;
$$;

create trigger audit_log_entries_no_update
  before update on public.audit_log_entries
  for each row execute function app.prevent_audit_mutation();

create trigger audit_log_entries_no_delete
  before delete on public.audit_log_entries
  for each row execute function app.prevent_audit_mutation();

-- ---------------------------------------------------------------------
-- 5. Contexto do ator
-- ---------------------------------------------------------------------
create or replace function app.current_actor_type()
returns public.audit_actor_type
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return 'system';
  end if;

  if exists (select 1 from public.reseller_admins ra where ra.user_id = v_uid) then
    return 'reseller_admin';
  end if;

  return 'user';
end;
$$;

comment on function app.current_actor_type() is 'Classifica o ator da transacao corrente. ai_agent e automation serao informados explicitamente pelos modulos que os introduzem.';

-- IP de origem, quando a requisicao vem do PostgREST. Fora dele (job do
-- worker, psql, migration) nao ha cabecalho e o retorno e nulo.
create or replace function app.current_ip()
returns inet
language plpgsql
stable
as $$
declare
  v_raw text;
begin
  v_raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  if v_raw is null or btrim(v_raw) = '' then
    return null;
  end if;
  -- x-forwarded-for pode trazer uma cadeia; o primeiro endereco e a origem.
  return split_part(v_raw, ',', 1)::inet;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Instrumento reutilizavel de escrita
-- ---------------------------------------------------------------------
create or replace function app.record_audit(
  p_workspace_id  uuid,
  p_action        text,
  p_resource_type text,
  p_resource_id   uuid       default null,
  p_before_state  jsonb      default null,
  p_after_state   jsonb      default null,
  p_actor_type    public.audit_actor_type default null,
  p_actor_id      uuid       default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_actor_type public.audit_actor_type := coalesce(p_actor_type, app.current_actor_type());
begin
  insert into public.audit_log_entries (
    workspace_id, actor_type, actor_id, action,
    resource_type, resource_id, before_state, after_state, ip_address
  )
  values (
    p_workspace_id,
    v_actor_type,
    coalesce(p_actor_id, auth.uid()),
    p_action,
    p_resource_type,
    p_resource_id,
    p_before_state,
    p_after_state,
    app.current_ip()
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app.record_audit is 'Unico instrumento de escrita na trilha. Usado por gatilhos e por rotas server-side. Nao concedido a authenticated: usuario final nao escreve na propria trilha.';

revoke all on function app.record_audit(uuid, text, text, uuid, jsonb, jsonb, public.audit_actor_type, uuid) from public, anon, authenticated;
grant execute on function app.record_audit(uuid, text, text, uuid, jsonb, jsonb, public.audit_actor_type, uuid) to service_role;

revoke all on function app.current_actor_type() from public, anon, authenticated;
grant execute on function app.current_actor_type() to service_role;

-- ---------------------------------------------------------------------
-- 7. Gatilhos sobre as tabelas de fundacao
-- ---------------------------------------------------------------------
create or replace function app.audit_workspaces()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_audit(new.id, 'workspace.created', 'workspace', new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    perform app.record_audit(new.id, 'workspace.updated', 'workspace', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    perform app.record_audit(old.id, 'workspace.deleted', 'workspace', old.id, to_jsonb(old), null);
    return old;
  end if;
end;
$$;

create trigger workspaces_audit
  after insert or update or delete on public.workspaces
  for each row execute function app.audit_workspaces();

create or replace function app.audit_workspace_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_audit(new.workspace_id, 'workspace_member.created', 'workspace_member', new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    perform app.record_audit(new.workspace_id, 'workspace_member.updated', 'workspace_member', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    perform app.record_audit(old.workspace_id, 'workspace_member.deleted', 'workspace_member', old.id, to_jsonb(old), null);
    return old;
  end if;
end;
$$;

create trigger workspace_members_audit
  after insert or update or delete on public.workspace_members
  for each row execute function app.audit_workspace_members();

-- reseller_admins tambem e auditada: conceder ou revogar acesso
-- cross-workspace e a operacao mais sensivel da plataforma. Como o registro
-- nao pertence a um tenant, a entrada usa o uuid nulo como workspace.
create or replace function app.audit_reseller_admins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.record_audit('00000000-0000-0000-0000-000000000000'::uuid,
      'reseller_admin.granted', 'reseller_admin', new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    perform app.record_audit('00000000-0000-0000-0000-000000000000'::uuid,
      'reseller_admin.updated', 'reseller_admin', new.id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    perform app.record_audit('00000000-0000-0000-0000-000000000000'::uuid,
      'reseller_admin.revoked', 'reseller_admin', old.id, to_jsonb(old), null);
    return old;
  end if;
end;
$$;

create trigger reseller_admins_audit
  after insert or update or delete on public.reseller_admins
  for each row execute function app.audit_reseller_admins();

-- ---------------------------------------------------------------------
-- 8. RLS e grants
-- ---------------------------------------------------------------------
alter table public.audit_log_entries enable row level security;
alter table public.audit_log_entries force row level security;

-- Leitura para membro ativo do workspace. Sem politica de INSERT, UPDATE ou
-- DELETE: escrita so por app.record_audit; alteracao, por ninguem.
create policy audit_log_entries_select_member
  on public.audit_log_entries for select to authenticated
  using (app.is_workspace_member(workspace_id));

revoke all on table public.audit_log_entries from anon, authenticated;
grant select on table public.audit_log_entries to authenticated;
