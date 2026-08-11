-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 4 (1/3): campanhas, influencia e resolucao
-- de identidade.
--
-- Vem antes de tarefas porque tasks.related_to_type inclui 'campaign'.
-- =====================================================================

create type public.campaign_type as enum ('pago', 'organico', 'offline');
create type public.campaign_member_status as enum ('alvo', 'respondeu', 'convertido');
create type public.influence_type as enum ('primeiro_toque', 'ultimo_toque', 'multi_toque');
create type public.identity_match_type as enum ('exact', 'fuzzy');
create type public.merge_status as enum ('pending_review', 'auto_merged', 'rejected');

create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 160),
  channel       text,
  type          public.campaign_type not null default 'pago',
  budget        numeric(18, 2) check (budget >= 0),
  start_date    date,
  end_date      date,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  status        text not null default 'ativa',
  constraint campaigns_periodo_coerente check (end_date is null or start_date is null or end_date >= start_date)
);

comment on column public.campaigns.budget is 'Orcamento em BRL, moeda base da plataforma. Nao ha coluna de moeda: a operacao e brasileira.';

create index campaigns_workspace_id_idx on public.campaigns (workspace_id);
create index campaigns_utm_idx on public.campaigns (workspace_id, utm_source, utm_medium, utm_campaign);
create index campaigns_periodo_idx on public.campaigns (workspace_id, start_date desc);

create table public.campaign_members (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id  uuid not null references public.contacts (id) on delete cascade,
  deal_id     uuid references public.deals (id) on delete set null,
  status      public.campaign_member_status not null default 'alvo',
  added_at    timestamptz not null default now(),
  constraint campaign_members_uniq unique (campaign_id, contact_id)
);

create index campaign_members_campaign_idx on public.campaign_members (campaign_id, status);
create index campaign_members_contact_idx on public.campaign_members (contact_id);
create index campaign_members_deal_idx on public.campaign_members (deal_id) where deal_id is not null;

create table public.campaign_influence (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null references public.deals (id) on delete cascade,
  campaign_id    uuid not null references public.campaigns (id) on delete cascade,
  influence_type public.influence_type not null,
  weight         numeric(5, 4) not null default 1 check (weight >= 0 and weight <= 1),
  constraint campaign_influence_uniq unique (deal_id, campaign_id, influence_type)
);

create index campaign_influence_deal_idx on public.campaign_influence (deal_id);
create index campaign_influence_campaign_idx on public.campaign_influence (campaign_id);

comment on column public.campaign_influence.weight is 'Peso da atribuicao, de 0 a 1. Em multi_toque a soma dos pesos de um negocio deveria fechar em 1; o banco nao impoe isso porque a regra de atribuicao pertence ao BI.';

create table public.identity_resolution_rules (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  match_fields        jsonb not null default '["email","phone"]'::jsonb,
  match_type          public.identity_match_type not null default 'exact',
  auto_merge_threshold numeric(5, 4) check (auto_merge_threshold between 0 and 1),
  constraint identity_rules_campos_validos check (jsonb_array_length(match_fields) > 0)
);

create index identity_resolution_rules_workspace_idx on public.identity_resolution_rules (workspace_id);
create index identity_resolution_rules_campos_gin on public.identity_resolution_rules using gin (match_fields jsonb_path_ops);

comment on column public.identity_resolution_rules.match_fields is 'Campos comparados: email, phone e documento (CPF/CNPJ, lido de custom_fields).';
comment on column public.identity_resolution_rules.auto_merge_threshold is 'Confianca a partir da qual a fusao dispensa revisao humana. Nulo significa que tudo passa por revisao.';

create table public.identity_merge_queue (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  candidate_contact_id uuid not null references public.contacts (id) on delete cascade,
  existing_contact_id  uuid not null references public.contacts (id) on delete cascade,
  confidence_score     numeric(5, 4) not null check (confidence_score between 0 and 1),
  status               public.merge_status not null default 'pending_review',
  reviewed_by          uuid references auth.users (id) on delete set null,
  constraint merge_queue_contatos_distintos check (candidate_contact_id <> existing_contact_id),
  constraint merge_queue_par_uniq unique (candidate_contact_id, existing_contact_id)
);

create index identity_merge_queue_workspace_idx on public.identity_merge_queue (workspace_id, status);
create index identity_merge_queue_candidato_idx on public.identity_merge_queue (candidate_contact_id);
create index identity_merge_queue_existente_idx on public.identity_merge_queue (existing_contact_id);

comment on table public.identity_merge_queue is 'Fila revisavel de duplicidades. Nada e fundido automaticamente sem passar por aqui: fusao errada e irreversivel na pratica.';

-- Deteccao de duplicidade por telefone, e-mail e documento. Retorna
-- candidatos, sem fundir nada: quem decide e a revisao humana.
-- (Esta versao e corrigida na migration 20260811224822 — colisao de nomes.)
create or replace function public.detect_duplicate_contacts(p_workspace_id uuid, p_contact_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contato public.contacts;
  v_regra public.identity_resolution_rules;
  v_doc text;
  v_inseridos integer := 0;
  r record;
begin
  if not app.is_workspace_member(p_workspace_id) then
    raise exception 'sem acesso a este workspace' using errcode = '42501';
  end if;

  select * into v_contato from public.contacts c
  where c.id = p_contact_id and c.workspace_id = p_workspace_id;
  if not found then
    raise exception 'contato nao encontrado' using errcode = 'P0002';
  end if;

  select * into v_regra from public.identity_resolution_rules r
  where r.workspace_id = p_workspace_id limit 1;

  v_doc := coalesce(
    v_contato.custom_fields ->> 'cpf',
    v_contato.custom_fields ->> 'cnpj',
    v_contato.custom_fields ->> 'documento'
  );

  for r in
    select c.id,
           case
             when v_doc is not null and coalesce(c.custom_fields->>'cpf', c.custom_fields->>'cnpj', c.custom_fields->>'documento') = v_doc then 0.98
             when v_contato.email is not null and lower(c.email) = lower(v_contato.email) then 0.90
             when v_contato.phone is not null
                  and regexp_replace(coalesce(c.phone,''), '[^0-9]', '', 'g') = regexp_replace(v_contato.phone, '[^0-9]', '', 'g')
                  and length(regexp_replace(v_contato.phone, '[^0-9]', '', 'g')) >= 8 then 0.75
             else 0
           end as score
    from public.contacts c
    where c.workspace_id = p_workspace_id
      and c.id <> p_contact_id
  loop
    if r.score > 0 then
      insert into public.identity_merge_queue
        (workspace_id, candidate_contact_id, existing_contact_id, confidence_score, status)
      values (
        p_workspace_id, p_contact_id, r.id, r.score,
        case
          when v_regra.auto_merge_threshold is not null and r.score >= v_regra.auto_merge_threshold
          then 'auto_merged'::public.merge_status
          else 'pending_review'::public.merge_status
        end
      )
      on conflict (candidate_contact_id, existing_contact_id) do nothing;
      v_inseridos := v_inseridos + 1;
    end if;
  end loop;

  return v_inseridos;
end;
$$;

revoke all on function public.detect_duplicate_contacts(uuid, uuid) from public, anon;
grant execute on function public.detect_duplicate_contacts(uuid, uuid) to authenticated;

alter table public.campaigns                enable row level security;
alter table public.campaigns                force row level security;
alter table public.campaign_members         enable row level security;
alter table public.campaign_members         force row level security;
alter table public.campaign_influence       enable row level security;
alter table public.campaign_influence       force row level security;
alter table public.identity_resolution_rules enable row level security;
alter table public.identity_resolution_rules force row level security;
alter table public.identity_merge_queue     enable row level security;
alter table public.identity_merge_queue     force row level security;

create policy campaigns_tenant on public.campaigns for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy identity_rules_tenant on public.identity_resolution_rules for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy merge_queue_tenant on public.identity_merge_queue for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Filhas de campaigns: isolamento derivado do pai (ADR-0013). O with check
-- exige que contato e negocio pertencam ao workspace da campanha.
create policy campaign_members_tenant on public.campaign_members for all to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (
    select 1 from public.campaigns c
    join public.contacts ct on ct.workspace_id = c.workspace_id
    where c.id = campaign_id and ct.id = contact_id and app.is_workspace_member(c.workspace_id)
  ));

create policy campaign_influence_tenant on public.campaign_influence for all to authenticated
  using (exists (select 1 from public.campaigns c where c.id = campaign_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (
    select 1 from public.campaigns c
    join public.deals d on d.workspace_id = c.workspace_id
    where c.id = campaign_id and d.id = deal_id and app.is_workspace_member(c.workspace_id)
  ));

revoke all on table public.campaigns, public.campaign_members, public.campaign_influence,
  public.identity_resolution_rules, public.identity_merge_queue from anon, authenticated;

grant select, insert, update, delete on table
  public.campaigns, public.campaign_members, public.campaign_influence,
  public.identity_resolution_rules, public.identity_merge_queue to authenticated;
