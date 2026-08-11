-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 3: pipelines paralelos com historico integro
--
-- O descritivo aponta como falha do produto substituido o modelo de uma
-- unica trilha por registro. Aqui uma mesma entidade pode estar em varios
-- pipelines ao mesmo tempo — um negocio percorrendo Vendas e Implantacao,
-- por exemplo — porque o vinculo esta em pipeline_items, e nao numa coluna
-- de estagio dentro da entidade.
-- =====================================================================

create table public.pipelines (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  name           text not null check (length(btrim(name)) between 1 and 120),
  entity_kind    public.entity_kind not null,
  object_type_id uuid references public.object_types (id) on delete cascade,
  is_default     boolean not null default false,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint pipelines_object_type_coerente check (
    (entity_kind = 'object_type' and object_type_id is not null)
    or (entity_kind <> 'object_type' and object_type_id is null)
  )
);

-- Um unico pipeline padrao por escopo. Indice parcial: a restricao so vale
-- para os marcados como padrao.
create unique index pipelines_default_uniq
  on public.pipelines (
    workspace_id, entity_kind,
    coalesce(object_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where is_default;

create index pipelines_workspace_id_idx on public.pipelines (workspace_id);
create index pipelines_escopo_idx on public.pipelines (workspace_id, entity_kind, object_type_id);

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 80),
  position    integer not null default 0,
  color       text,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  probability numeric(5, 2) check (probability between 0 and 100),
  wip_limit   integer check (wip_limit is null or wip_limit > 0),
  created_at  timestamptz not null default now(),

  -- Um estagio nao pode ser ganho e perdido ao mesmo tempo.
  constraint pipeline_stages_desfecho_coerente check (not (is_won and is_lost))
);

create index pipeline_stages_pipeline_idx on public.pipeline_stages (pipeline_id, position);

comment on column public.pipeline_stages.position is 'Ordem das colunas no quadro. A interface usa esta coluna para desenhar o pipeline da esquerda para a direita.';
comment on column public.pipeline_stages.wip_limit is 'Limite de itens simultaneos no estagio. Sinalizacao visual nesta etapa; bloqueio automatico depende do motor de automacoes.';

create table public.pipeline_items (
  id                 uuid primary key default gen_random_uuid(),
  pipeline_id        uuid not null references public.pipelines (id) on delete cascade,
  stage_id           uuid not null references public.pipeline_stages (id) on delete restrict,
  entity_kind        public.entity_kind not null,
  entity_id          uuid not null,
  position_in_stage  integer not null default 0,
  entered_stage_at   timestamptz not null default now(),
  assigned_to        uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- A mesma entidade entra uma vez por pipeline. Em pipelines diferentes,
  -- quantas vezes forem necessarias — e disso que vem a trilha paralela.
  constraint pipeline_items_entidade_uniq unique (pipeline_id, entity_id)
);

create index pipeline_items_pipeline_idx on public.pipeline_items (pipeline_id);
create index pipeline_items_estagio_idx on public.pipeline_items (stage_id, position_in_stage);
create index pipeline_items_entidade_idx on public.pipeline_items (entity_kind, entity_id);
create index pipeline_items_responsavel_idx on public.pipeline_items (assigned_to) where assigned_to is not null;

comment on column public.pipeline_items.position_in_stage is 'Ordem do card dentro da coluna. Arrastar um card atualiza stage_id e/ou esta coluna.';
comment on column public.pipeline_items.entity_id is 'Referencia polimorfica (contato, empresa, negocio ou registro de objeto). Sem FK por apontar para quatro tabelas; o gatilho valida a existencia no mesmo workspace.';

create table public.pipeline_stage_history (
  id               uuid primary key default gen_random_uuid(),
  pipeline_item_id uuid not null,
  from_stage_id    uuid,
  to_stage_id      uuid not null,
  moved_by         uuid,
  moved_at         timestamptz not null default now(),
  duration_seconds bigint
);

create index pipeline_stage_history_item_idx on public.pipeline_stage_history (pipeline_item_id, moved_at desc);
create index pipeline_stage_history_estagios_idx on public.pipeline_stage_history (to_stage_id, moved_at desc);

comment on table public.pipeline_stage_history is 'Historico integro de movimentacao. Alimenta tempo por estagio e taxa de conversao no BI.';
comment on column public.pipeline_stage_history.pipeline_item_id is 'Sem FK: o historico precisa sobreviver a exclusao do item, senao o registro de um negocio perdido desaparece junto com ele. Mesma logica de audit_log_entries (ADR-0008).';
comment on column public.pipeline_stage_history.duration_seconds is 'Tempo que o item permaneceu no estagio anterior. Nulo na entrada inicial, que nao tem estagio anterior.';

-- ---------------------------------------------------------------------
-- Historico automatico
-- ---------------------------------------------------------------------
-- O gatilho vive no banco, e nao no codigo da interface, porque o mesmo
-- movimento vai vir de varias origens nas proximas etapas: arrastar o card,
-- uma automacao, um agente de IA ou uma importacao. Historico registrado
-- apenas por quem lembra de registrar nao e historico.
create or replace function app.registrar_movimentacao_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.pipeline_stage_history (pipeline_item_id, from_stage_id, to_stage_id, moved_by, duration_seconds)
    values (new.id, null, new.stage_id, auth.uid(), null);
    return new;
  end if;

  if new.stage_id is distinct from old.stage_id then
    insert into public.pipeline_stage_history (pipeline_item_id, from_stage_id, to_stage_id, moved_by, duration_seconds)
    values (
      new.id,
      old.stage_id,
      new.stage_id,
      auth.uid(),
      greatest(0, floor(extract(epoch from (now() - old.entered_stage_at)))::bigint)
    );
  end if;

  return new;
end;
$$;

-- Quem move o card nao precisa lembrar de atualizar entered_stage_at: sem
-- isso, o proximo calculo de duracao sairia errado em silencio.
create or replace function app.marcar_entrada_estagio()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.stage_id is distinct from old.stage_id then
    new.entered_stage_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.enforce_pipeline_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline record;
begin
  select p.* into v_pipeline from public.pipelines p where p.id = new.pipeline_id;

  if v_pipeline.entity_kind <> new.entity_kind then
    raise exception 'o pipeline aceita % e o item e %', v_pipeline.entity_kind, new.entity_kind
      using errcode = '23514';
  end if;

  if not app.check_relation_target(v_pipeline.workspace_id, new.entity_kind, new.entity_id) then
    raise exception 'entidade do item nao existe neste workspace' using errcode = '23503';
  end if;

  if not exists (
    select 1 from public.pipeline_stages s
    where s.id = new.stage_id and s.pipeline_id = new.pipeline_id
  ) then
    raise exception 'o estagio nao pertence a este pipeline' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger pipeline_items_valida
  before insert or update on public.pipeline_items
  for each row execute function app.enforce_pipeline_item();

create trigger pipeline_items_marca_entrada
  before insert or update on public.pipeline_items
  for each row execute function app.marcar_entrada_estagio();

create trigger pipeline_items_historico
  after insert or update on public.pipeline_items
  for each row execute function app.registrar_movimentacao_pipeline();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.pipelines             enable row level security;
alter table public.pipelines             force row level security;
alter table public.pipeline_stages       enable row level security;
alter table public.pipeline_stages       force row level security;
alter table public.pipeline_items        enable row level security;
alter table public.pipeline_items        force row level security;
alter table public.pipeline_stage_history enable row level security;
alter table public.pipeline_stage_history force row level security;

create policy pipelines_tenant on public.pipelines for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Tabelas filhas: o escopo desta etapa nao lhes da workspace_id, entao o
-- isolamento vem do pipeline pai. Ver ADR-0013.
create policy pipeline_stages_tenant on public.pipeline_stages for all to authenticated
  using (exists (select 1 from public.pipelines p where p.id = pipeline_id and app.is_workspace_member(p.workspace_id)))
  with check (exists (select 1 from public.pipelines p where p.id = pipeline_id and app.is_workspace_member(p.workspace_id)));

create policy pipeline_items_tenant on public.pipeline_items for all to authenticated
  using (exists (select 1 from public.pipelines p where p.id = pipeline_id and app.is_workspace_member(p.workspace_id)))
  with check (exists (select 1 from public.pipelines p where p.id = pipeline_id and app.is_workspace_member(p.workspace_id)));

-- Historico e somente leitura para o usuario: quem escreve e o gatilho.
create policy pipeline_stage_history_select on public.pipeline_stage_history for select to authenticated
  using (exists (
    select 1
    from public.pipeline_items i
    join public.pipelines p on p.id = i.pipeline_id
    where i.id = pipeline_item_id and app.is_workspace_member(p.workspace_id)
  ));

revoke all on table public.pipelines, public.pipeline_stages,
  public.pipeline_items, public.pipeline_stage_history from anon, authenticated;

grant select, insert, update, delete on table
  public.pipelines, public.pipeline_stages, public.pipeline_items to authenticated;

grant select on table public.pipeline_stage_history to authenticated;
