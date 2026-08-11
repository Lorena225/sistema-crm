-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 1: Fundacao de multi-tenancy
-- Tabelas: workspaces, workspace_members, reseller_admins
-- Escopo estrito da Etapa 1. Nao cria audit_log_entries, billing,
-- filas, CRM, canais ou IA (etapas posteriores).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Extensoes
-- ---------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;
-- pgvector provisionado agora, sem funcionalidade de IA nesta etapa.
create extension if not exists vector with schema extensions;

-- ---------------------------------------------------------------------
-- 2. Schema interno de helpers (nao exposto via PostgREST)
-- ---------------------------------------------------------------------
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

comment on schema app is 'Helpers internos (SECURITY DEFINER) usados por politicas RLS. Nao exposto via API.';

-- ---------------------------------------------------------------------
-- 3. Enums de fundacao
-- ---------------------------------------------------------------------
create type public.workspace_status as enum ('active', 'suspended', 'canceled');
create type public.workspace_role as enum ('owner', 'admin', 'manager', 'agent', 'viewer');
create type public.workspace_member_status as enum ('invited', 'active', 'disabled');
create type public.reseller_scope as enum ('all_workspaces');

comment on type public.workspace_role is 'Valores-base de papel. O motor granular de permissoes (RBAC/ABAC) chega na Etapa 9.';

-- ---------------------------------------------------------------------
-- 4. workspaces (tenant raiz)
-- ---------------------------------------------------------------------
create table public.workspaces (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null check (length(btrim(name)) between 1 and 120),
  slug                    text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,46}[a-z0-9])?$'),
  plan                    text not null default 'unassigned',
  status                  public.workspace_status not null default 'active',
  auto_summary_on_resolve boolean not null default true,
  created_at              timestamptz not null default now()
);

create unique index workspaces_slug_uniq on public.workspaces (lower(slug));
create index workspaces_status_idx on public.workspaces (status);

comment on table public.workspaces is 'Tenant raiz da plataforma. Todo dado operacional pertence a um workspace_id.';
comment on column public.workspaces.plan is 'Identificador livre de plano. Etapa 1 NAO codifica semantica comercial: valores, franquias e gateways sao parametrizados em etapa posterior.';
comment on column public.workspaces.auto_summary_on_resolve is 'Flag global do workspace que controlara o resumo automatico de conversas em todos os canais (funcionalidade de etapa futura).';

-- ---------------------------------------------------------------------
-- 5. workspace_members (vinculo auth.uid() <-> workspace)
-- ---------------------------------------------------------------------
create table public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         public.workspace_role not null default 'agent',
  status       public.workspace_member_status not null default 'active',
  created_at   timestamptz not null default now(),
  constraint workspace_members_workspace_user_uniq unique (workspace_id, user_id)
);

create index workspace_members_workspace_id_idx on public.workspace_members (workspace_id);
create index workspace_members_user_id_idx on public.workspace_members (user_id);
-- Indice de cobertura para as politicas RLS (lookup por usuario + workspace + status ativo).
create index workspace_members_rls_lookup_idx
  on public.workspace_members (user_id, workspace_id, status)
  where status = 'active';

comment on table public.workspace_members is 'Associacao entre um usuario do Supabase Auth e um workspace. Associacao ativa e a condicao de acesso ao tenant.';

-- ---------------------------------------------------------------------
-- 6. reseller_admins (acesso cross-workspace da VirtruvIA)
-- ---------------------------------------------------------------------
create table public.reseller_admins (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  scope   public.reseller_scope not null default 'all_workspaces',
  constraint reseller_admins_user_id_uniq unique (user_id)
);

create index reseller_admins_scope_idx on public.reseller_admins (scope);

comment on table public.reseller_admins is 'Acesso administrativo cross-workspace da VirtruvIA. Uso exclusivamente server-side, sob politica administrativa separada e auditavel. NUNCA exposto ao client-side.';

-- ---------------------------------------------------------------------
-- 7. Helpers de RLS (SECURITY DEFINER para evitar recursao de politica)
-- ---------------------------------------------------------------------
create or replace function app.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$$;

create or replace function app.has_workspace_role(p_workspace_id uuid, p_roles public.workspace_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = any (p_roles)
  );
$$;

create or replace function app.is_reseller_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.reseller_admins ra where ra.user_id = auth.uid()
  );
$$;

comment on function app.is_reseller_admin() is 'Checagem de reseller admin. Uso restrito a rotas server-side; nao e usada em nenhuma politica RLS de tenant.';

revoke all on function app.is_workspace_member(uuid) from public, anon;
revoke all on function app.has_workspace_role(uuid, public.workspace_role[]) from public, anon;
revoke all on function app.is_reseller_admin() from public, anon, authenticated;
grant execute on function app.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function app.has_workspace_role(uuid, public.workspace_role[]) to authenticated, service_role;
grant execute on function app.is_reseller_admin() to service_role;

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;
alter table public.reseller_admins enable row level security;
alter table public.reseller_admins force row level security;

-- workspaces: leitura para membro ativo; escrita para owner/admin.
-- INSERT nao tem politica: criacao de workspace ocorre apenas via RPC
-- public.create_workspace (SECURITY DEFINER), garantindo owner atomico.
create policy workspaces_select_member
  on public.workspaces for select to authenticated
  using (app.is_workspace_member(id));

create policy workspaces_update_admin
  on public.workspaces for update to authenticated
  using (app.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]))
  with check (app.has_workspace_role(id, array['owner', 'admin']::public.workspace_role[]));

-- workspace_members: membro ativo enxerga os colegas do mesmo workspace;
-- somente owner/admin gerenciam associacoes.
create policy workspace_members_select_member
  on public.workspace_members for select to authenticated
  using (app.is_workspace_member(workspace_id));

create policy workspace_members_insert_admin
  on public.workspace_members for insert to authenticated
  with check (app.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy workspace_members_update_admin
  on public.workspace_members for update to authenticated
  using (app.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (app.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy workspace_members_delete_admin
  on public.workspace_members for delete to authenticated
  using (app.has_workspace_role(workspace_id, array['owner', 'admin']::public.workspace_role[]));

-- reseller_admins: RLS habilitada e NENHUMA politica de tenant.
-- Deny-by-default para anon/authenticated; acesso apenas server-side.

-- ---------------------------------------------------------------------
-- 9. Grants explicitos
-- ---------------------------------------------------------------------
revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.workspace_members from anon, authenticated;
revoke all on table public.reseller_admins from anon, authenticated;

grant select, update on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_members to authenticated;
-- reseller_admins: sem grant para anon/authenticated (apenas service_role/postgres).
