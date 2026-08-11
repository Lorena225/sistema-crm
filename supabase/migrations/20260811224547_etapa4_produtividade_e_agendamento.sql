-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 4 (2/3): tarefas, resultados, checklists,
-- recorrencias, calendario (contrato) e agendamento publico.
-- =====================================================================

create type public.task_category as enum
  ('ligação', 'reunião', 'visita', 'e-mail', 'follow_up', 'administrativa', 'entrega', 'outro');
create type public.task_priority as enum ('baixa', 'média', 'alta', 'urgente');
create type public.task_status as enum ('pendente', 'em_andamento', 'concluída', 'cancelada');
create type public.task_source as enum
  ('manual', 'automação', 'agente_ia', 'gatilho_de_etapa', 'agendamento_publico');
create type public.related_to_type as enum ('contact', 'company', 'deal', 'case', 'campaign');
create type public.sync_direction as enum ('bidirectional', 'push_only');

-- Catalogo global por workspace: sem FK de pipeline ou departamento, de
-- proposito. Amarrar o tipo de tarefa a um funil impediria "ligação" de
-- existir no resto da operacao.
create table public.task_types (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces (id) on delete cascade,
  code                     text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name                     text not null check (length(btrim(name)) between 1 and 120),
  default_description      text,
  category                 public.task_category not null default 'outro',
  default_duration_minutes integer check (default_duration_minutes > 0),
  default_priority         public.task_priority not null default 'média',
  color                    text,
  requires_outcome         boolean not null default false,
  is_active                boolean not null default true
);

create unique index task_types_code_uniq on public.task_types (workspace_id, lower(code));
create index task_types_workspace_idx on public.task_types (workspace_id, is_active);

create table public.task_outcome_types (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_type_id uuid not null references public.task_types (id) on delete cascade,
  code         text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  label        text not null,
  is_positive  boolean not null default true,
  constraint task_outcome_types_code_uniq unique (task_type_id, code)
);

create index task_outcome_types_workspace_idx on public.task_outcome_types (workspace_id);
create index task_outcome_types_tipo_idx on public.task_outcome_types (task_type_id);

create table public.task_checklist_templates (
  id           uuid primary key default gen_random_uuid(),
  task_type_id uuid not null references public.task_types (id) on delete cascade,
  label        text not null
);

create index task_checklist_templates_tipo_idx on public.task_checklist_templates (task_type_id);

create table public.task_checklist_template_items (
  id                          uuid primary key default gen_random_uuid(),
  task_checklist_template_id  uuid not null references public.task_checklist_templates (id) on delete cascade,
  label                       text not null,
  "order"                     integer not null default 0
);

create index task_checklist_template_items_tpl_idx
  on public.task_checklist_template_items (task_checklist_template_id, "order");

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  task_type_id    uuid references public.task_types (id) on delete set null,
  title           text not null check (length(btrim(title)) between 1 and 200),
  description     text,
  related_to_type public.related_to_type,
  related_to_id   uuid,
  assigned_to     uuid references auth.users (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  due_at          timestamptz,
  reminder_at     timestamptz,
  priority        public.task_priority not null default 'média',
  status          public.task_status not null default 'pendente',
  completed_at    timestamptz,
  outcome_type_id uuid references public.task_outcome_types (id) on delete set null,
  outcome_notes   text,
  source          public.task_source not null default 'manual',
  constraint tasks_relacao_coerente check (
    (related_to_type is null and related_to_id is null)
    or (related_to_type is not null and related_to_id is not null)
  )
);

-- Atraso NAO e coluna: e due_at < now() com status pendente. Persistir
-- "atrasada" exigiria um job varrendo a tabela e produziria estado errado
-- entre uma varredura e outra.
comment on table public.tasks is 'Atraso e calculado, nunca persistido: due_at < now() com status pendente.';

create index tasks_workspace_idx on public.tasks (workspace_id);
create index tasks_responsavel_idx on public.tasks (workspace_id, assigned_to, status);
create index tasks_vencimento_idx on public.tasks (workspace_id, due_at) where status = 'pendente';
create index tasks_relacao_idx on public.tasks (workspace_id, related_to_type, related_to_id);
create index tasks_tipo_idx on public.tasks (task_type_id);
create index tasks_lembrete_idx on public.tasks (reminder_at) where reminder_at is not null and status = 'pendente';

create table public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  body       text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now()
);

create index task_comments_task_idx on public.task_comments (task_id, created_at);

create table public.task_recurrences (
  id                 uuid primary key default gen_random_uuid(),
  task_type_id       uuid not null references public.task_types (id) on delete cascade,
  recurrence_rule    text not null,
  related_to_type    public.related_to_type,
  related_to_id      uuid,
  assigned_to        uuid references auth.users (id) on delete set null,
  next_generation_at timestamptz
);

create index task_recurrences_tipo_idx on public.task_recurrences (task_type_id);
create index task_recurrences_proxima_idx on public.task_recurrences (next_generation_at)
  where next_generation_at is not null;

comment on column public.task_recurrences.recurrence_rule is 'Regra no formato RRULE (RFC 5545). A geracao das ocorrencias e trabalho do worker, em etapa futura; aqui fica o contrato.';

-- Integracao de calendario: contrato e schema apenas. Nenhum conector OAuth
-- real nesta etapa, por escopo.
create table public.calendar_integrations (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  provider             text not null,
  external_calendar_id text not null,
  sync_direction       public.sync_direction not null default 'bidirectional',
  constraint calendar_integrations_uniq unique (user_id, provider, external_calendar_id)
);

create index calendar_integrations_user_idx on public.calendar_integrations (user_id);

comment on table public.calendar_integrations is 'Pertence ao usuario, nao ao workspace: uma agenda pessoal atravessa os workspaces de que a pessoa participa. A RLS usa auth.uid() diretamente.';

create table public.calendar_event_links (
  id                      uuid primary key default gen_random_uuid(),
  task_id                 uuid not null references public.tasks (id) on delete cascade,
  calendar_integration_id uuid not null references public.calendar_integrations (id) on delete cascade,
  external_event_id       text not null,
  constraint calendar_event_links_uniq unique (calendar_integration_id, external_event_id)
);

create index calendar_event_links_task_idx on public.calendar_event_links (task_id);

comment on table public.calendar_event_links is 'Evita duplicacao na sincronizacao: um evento externo tem um unico vinculo por integracao.';

create table public.booking_pages (
  id                       uuid primary key default gen_random_uuid(),
  workspace_id             uuid not null references public.workspaces (id) on delete cascade,
  user_id                  uuid references auth.users (id) on delete set null,
  team_id                  uuid,
  slug                     text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,60}[a-z0-9])?$'),
  title                    text not null,
  default_duration_minutes integer not null default 30 check (default_duration_minutes > 0),
  buffer_between_meetings  integer not null default 0 check (buffer_between_meetings >= 0),
  task_type_id             uuid references public.task_types (id) on delete set null
);

create unique index booking_pages_slug_uniq on public.booking_pages (lower(slug));
create index booking_pages_workspace_idx on public.booking_pages (workspace_id);

comment on column public.booking_pages.team_id is 'Sem FK: nao existe tabela de times nesta etapa. A coluna consta do escopo e fica reservada.';
comment on index public.booking_pages_slug_uniq is 'Unico globalmente, e nao por workspace: a URL publica /agendar/<slug> nao carrega o tenant.';

create table public.booking_slots (
  id              uuid primary key default gen_random_uuid(),
  booking_page_id uuid not null references public.booking_pages (id) on delete cascade,
  day_of_week     smallint check (day_of_week between 0 and 6),
  date            date,
  start_time      time not null,
  end_time        time not null,
  is_available    boolean not null default true,
  constraint booking_slots_janela_valida check (end_time > start_time),
  -- Ou recorrente por dia da semana, ou uma data especifica. Os dois juntos
  -- seriam ambiguos; nenhum dos dois nao define quando o slot existe.
  constraint booking_slots_dia_ou_data check (
    (day_of_week is not null and date is null) or (day_of_week is null and date is not null)
  )
);

create index booking_slots_pagina_idx on public.booking_slots (booking_page_id, is_available);
create index booking_slots_dia_idx on public.booking_slots (booking_page_id, day_of_week) where day_of_week is not null;
create index booking_slots_data_idx on public.booking_slots (booking_page_id, date) where date is not null;

-- ---------------------------------------------------------------------
-- Reserva publica
-- ---------------------------------------------------------------------
-- Quem agenda nao tem sessao. Em vez de abrir as tabelas para o papel anon,
-- toda a operacao passa por esta funcao, que valida a janela, respeita o
-- buffer e cria contato, negocio e tarefa numa unica transacao. Ver ADR-0016.
create or replace function public.create_public_booking(
  p_slug          text,
  p_starts_at     timestamptz,
  p_nome          text,
  p_email         text default null,
  p_telefone      text default null,
  p_observacoes   text default null,
  p_criar_negocio boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pagina public.booking_pages;
  v_fim timestamptz;
  v_slot_ok boolean := false;
  v_contato_id uuid;
  v_deal_id uuid := null;
  v_task_id uuid;
  v_hora time := (p_starts_at at time zone 'America/Sao_Paulo')::time;
  v_data date := (p_starts_at at time zone 'America/Sao_Paulo')::date;
  v_dow smallint := extract(dow from (p_starts_at at time zone 'America/Sao_Paulo'))::smallint;
begin
  select * into v_pagina from public.booking_pages bp where lower(bp.slug) = lower(btrim(p_slug));
  if not found then
    raise exception 'pagina de agendamento nao encontrada' using errcode = 'P0002';
  end if;

  if p_starts_at < now() then
    raise exception 'nao e possivel agendar no passado' using errcode = '22023';
  end if;

  v_fim := p_starts_at + make_interval(mins => v_pagina.default_duration_minutes);

  -- A janela precisa caber inteira em um slot disponivel.
  select true into v_slot_ok
  from public.booking_slots s
  where s.booking_page_id = v_pagina.id
    and s.is_available
    and ((s.date = v_data) or (s.day_of_week = v_dow))
    and s.start_time <= v_hora
    and s.end_time >= (v_hora + make_interval(mins => v_pagina.default_duration_minutes))
  limit 1;

  if not coalesce(v_slot_ok, false) then
    raise exception 'horario fora das janelas disponiveis' using errcode = '23514';
  end if;

  -- Buffer: nenhuma outra reserva desta pagina pode encostar na janela,
  -- somando o intervalo configurado dos dois lados.
  if exists (
    select 1 from public.tasks t
    where t.workspace_id = v_pagina.workspace_id
      and t.source = 'agendamento_publico'
      and t.status <> 'cancelada'
      and t.due_at is not null
      and t.due_at < v_fim + make_interval(mins => v_pagina.buffer_between_meetings)
      and t.due_at + make_interval(mins => v_pagina.default_duration_minutes)
          > p_starts_at - make_interval(mins => v_pagina.buffer_between_meetings)
  ) then
    raise exception 'horario indisponivel' using errcode = '23505';
  end if;

  -- Contato: reaproveita por e-mail antes de criar, para nao gerar duplicata
  -- a cada reserva da mesma pessoa.
  if p_email is not null then
    select c.id into v_contato_id from public.contacts c
    where c.workspace_id = v_pagina.workspace_id and lower(c.email) = lower(p_email)
    limit 1;
  end if;

  if v_contato_id is null then
    insert into public.contacts (workspace_id, name, email, phone, source)
    values (v_pagina.workspace_id, btrim(p_nome), p_email, p_telefone, 'agendamento_publico')
    returning id into v_contato_id;
  end if;

  if p_criar_negocio then
    insert into public.deals (workspace_id, title, contact_id)
    values (v_pagina.workspace_id, 'Reunião: ' || btrim(p_nome), v_contato_id)
    returning id into v_deal_id;
  end if;

  insert into public.tasks (
    workspace_id, task_type_id, title, description,
    related_to_type, related_to_id, assigned_to,
    due_at, priority, status, source
  )
  values (
    v_pagina.workspace_id, v_pagina.task_type_id,
    v_pagina.title || ' — ' || btrim(p_nome), p_observacoes,
    case when v_deal_id is not null then 'deal' else 'contact' end::public.related_to_type,
    coalesce(v_deal_id, v_contato_id),
    v_pagina.user_id, p_starts_at, 'média', 'pendente', 'agendamento_publico'
  )
  returning id into v_task_id;

  return v_task_id;
end;
$$;

revoke all on function public.create_public_booking(text, timestamptz, text, text, text, text, boolean) from public;
grant execute on function public.create_public_booking(text, timestamptz, text, text, text, text, boolean) to anon, authenticated;

-- Leitura publica da pagina e das janelas, sem expor o resto do tenant.
create or replace function public.get_public_booking_page(p_slug text)
returns table (
  slug text, title text, default_duration_minutes integer,
  buffer_between_meetings integer,
  slots jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select bp.slug, bp.title, bp.default_duration_minutes, bp.buffer_between_meetings,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'day_of_week', s.day_of_week, 'date', s.date,
             'start_time', s.start_time, 'end_time', s.end_time)
             order by s.day_of_week nulls last, s.date nulls last, s.start_time)
           from public.booking_slots s
           where s.booking_page_id = bp.id and s.is_available
         ), '[]'::jsonb)
  from public.booking_pages bp
  where lower(bp.slug) = lower(btrim(p_slug));
$$;

revoke all on function public.get_public_booking_page(text) from public;
grant execute on function public.get_public_booking_page(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.task_types                    enable row level security;
alter table public.task_types                    force row level security;
alter table public.task_outcome_types            enable row level security;
alter table public.task_outcome_types            force row level security;
alter table public.task_checklist_templates      enable row level security;
alter table public.task_checklist_templates      force row level security;
alter table public.task_checklist_template_items enable row level security;
alter table public.task_checklist_template_items force row level security;
alter table public.tasks                         enable row level security;
alter table public.tasks                         force row level security;
alter table public.task_comments                 enable row level security;
alter table public.task_comments                 force row level security;
alter table public.task_recurrences              enable row level security;
alter table public.task_recurrences              force row level security;
alter table public.calendar_integrations         enable row level security;
alter table public.calendar_integrations         force row level security;
alter table public.calendar_event_links          enable row level security;
alter table public.calendar_event_links          force row level security;
alter table public.booking_pages                 enable row level security;
alter table public.booking_pages                 force row level security;
alter table public.booking_slots                 enable row level security;
alter table public.booking_slots                 force row level security;

create policy task_types_tenant on public.task_types for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy task_outcome_types_tenant on public.task_outcome_types for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy tasks_tenant on public.tasks for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy booking_pages_tenant on public.booking_pages for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Filhas: isolamento derivado do pai (ADR-0013).
create policy task_checklist_templates_tenant on public.task_checklist_templates for all to authenticated
  using (exists (select 1 from public.task_types t where t.id = task_type_id and app.is_workspace_member(t.workspace_id)))
  with check (exists (select 1 from public.task_types t where t.id = task_type_id and app.is_workspace_member(t.workspace_id)));

create policy task_checklist_items_tenant on public.task_checklist_template_items for all to authenticated
  using (exists (
    select 1 from public.task_checklist_templates tpl
    join public.task_types t on t.id = tpl.task_type_id
    where tpl.id = task_checklist_template_id and app.is_workspace_member(t.workspace_id)))
  with check (exists (
    select 1 from public.task_checklist_templates tpl
    join public.task_types t on t.id = tpl.task_type_id
    where tpl.id = task_checklist_template_id and app.is_workspace_member(t.workspace_id)));

create policy task_comments_tenant on public.task_comments for all to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and app.is_workspace_member(t.workspace_id)))
  with check (exists (select 1 from public.tasks t where t.id = task_id and app.is_workspace_member(t.workspace_id)));

create policy task_recurrences_tenant on public.task_recurrences for all to authenticated
  using (exists (select 1 from public.task_types t where t.id = task_type_id and app.is_workspace_member(t.workspace_id)))
  with check (exists (select 1 from public.task_types t where t.id = task_type_id and app.is_workspace_member(t.workspace_id)));

create policy booking_slots_tenant on public.booking_slots for all to authenticated
  using (exists (select 1 from public.booking_pages p where p.id = booking_page_id and app.is_workspace_member(p.workspace_id)))
  with check (exists (select 1 from public.booking_pages p where p.id = booking_page_id and app.is_workspace_member(p.workspace_id)));

-- Agenda pessoal: a chave e o proprio usuario, nao o workspace.
create policy calendar_integrations_proprio on public.calendar_integrations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy calendar_event_links_proprio on public.calendar_event_links for all to authenticated
  using (exists (select 1 from public.calendar_integrations ci where ci.id = calendar_integration_id and ci.user_id = auth.uid()))
  with check (exists (select 1 from public.calendar_integrations ci where ci.id = calendar_integration_id and ci.user_id = auth.uid()));

revoke all on table public.task_types, public.task_outcome_types,
  public.task_checklist_templates, public.task_checklist_template_items,
  public.tasks, public.task_comments, public.task_recurrences,
  public.calendar_integrations, public.calendar_event_links,
  public.booking_pages, public.booking_slots from anon, authenticated;

grant select, insert, update, delete on table
  public.task_types, public.task_outcome_types,
  public.task_checklist_templates, public.task_checklist_template_items,
  public.tasks, public.task_comments, public.task_recurrences,
  public.calendar_integrations, public.calendar_event_links,
  public.booking_pages, public.booking_slots to authenticated;
