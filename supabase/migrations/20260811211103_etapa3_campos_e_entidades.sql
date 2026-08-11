-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 3: campos configuraveis, entidades CRM
-- e objetos customizados.
--
-- Reutiliza a fundacao das etapas anteriores: workspace_id + RLS por
-- associacao ativa (Etapa 1) e app.record_audit (Etapa 2).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------
-- O escopo escreve entity_kind como "(contact|company|deal|object_type_id)".
-- Traduzido para o banco: um enum com o quarto valor sendo `object_type`, e a
-- coluna object_type_id apontando qual tipo. Um enum nao pode conter um id.
create type public.entity_kind as enum ('contact', 'company', 'deal', 'object_type');

create type public.field_type as enum (
  'text', 'number', 'currency', 'date', 'boolean',
  'select', 'multiselect', 'relation', 'email', 'phone', 'ai_generated'
);

create type public.field_sensitivity as enum ('none', 'pii', 'financial');
create type public.field_change_type as enum ('created', 'updated', 'deleted');
create type public.deal_status as enum ('open', 'won', 'lost');

-- ---------------------------------------------------------------------
-- 2. field_definitions
-- ---------------------------------------------------------------------
create table public.field_definitions (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces (id) on delete cascade,
  entity_kind          public.entity_kind not null,
  object_type_id       uuid,
  key                  text not null check (key ~ '^[a-z][a-z0-9_]{0,48}[a-z0-9]$'),
  label                text not null check (length(btrim(label)) between 1 and 120),
  field_type           public.field_type not null,
  options              jsonb not null default '[]'::jsonb,
  ai_generation_config jsonb not null default '{}'::jsonb,
  is_required          boolean not null default false,
  is_filterable        boolean not null default false,
  position             integer not null default 0,
  editable_roles       text[] not null default '{}',
  sensitivity_level    public.field_sensitivity not null default 'none',
  created_at           timestamptz not null default now(),

  -- object_type_id existe exatamente quando o campo pertence a um objeto
  -- customizado. Sem isso, um campo poderia ficar orfao ou ambiguo.
  constraint field_definitions_object_type_coerente check (
    (entity_kind = 'object_type' and object_type_id is not null)
    or (entity_kind <> 'object_type' and object_type_id is null)
  ),
  -- select e multiselect precisam de opcoes; os demais tipos nao as usam.
  constraint field_definitions_options_coerente check (
    (field_type in ('select', 'multiselect') and jsonb_array_length(options) > 0)
    or (field_type not in ('select', 'multiselect'))
  )
);

-- A chave e unica dentro do escopo em que o campo vive. coalesce permite
-- que dois objetos customizados diferentes tenham ambos um campo `codigo`.
create unique index field_definitions_key_uniq
  on public.field_definitions (
    workspace_id, entity_kind,
    coalesce(object_type_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(key)
  );

create index field_definitions_workspace_id_idx on public.field_definitions (workspace_id);
create index field_definitions_escopo_idx
  on public.field_definitions (workspace_id, entity_kind, object_type_id, position);
create index field_definitions_object_type_idx
  on public.field_definitions (object_type_id) where object_type_id is not null;

comment on table public.field_definitions is 'Metadados dos campos customizados. E contra esta tabela que custom_fields e validado antes de persistir.';
comment on column public.field_definitions.ai_generation_config is 'Preservado para a runtime de IA das etapas seguintes. Nesta etapa e apenas guardado: nada gera valor a partir dele.';
comment on column public.field_definitions.editable_roles is 'Papeis autorizados a editar o campo. O motor granular de permissoes chega na Etapa 9; aqui a coluna e apenas declarativa.';
comment on column public.field_definitions.sensitivity_level is 'Classificacao do dado. Usada pela auditoria para nao copiar conteudo sensivel, e por politicas futuras de mascaramento.';

-- ---------------------------------------------------------------------
-- 3. field_schema_versions
-- ---------------------------------------------------------------------
create table public.field_schema_versions (
  id                  uuid primary key default gen_random_uuid(),
  field_definition_id uuid not null,
  version             integer not null,
  change_type         public.field_change_type not null,
  changed_by          uuid,
  created_at          timestamptz not null default now(),
  constraint field_schema_versions_versao_uniq unique (field_definition_id, version)
);

create index field_schema_versions_definition_idx
  on public.field_schema_versions (field_definition_id, version desc);

comment on table public.field_schema_versions is 'Historico de alteracoes de cada definicao de campo.';
comment on column public.field_schema_versions.field_definition_id is 'Sem FK de proposito: o historico precisa sobreviver a exclusao da definicao, senao a versao `deleted` se apagaria junto com o que ela registra. Mesma logica de audit_log_entries (ADR-0008).';

-- ---------------------------------------------------------------------
-- 4. Versionamento automatico
-- ---------------------------------------------------------------------
create or replace function app.version_field_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.id, old.id);
  v_proxima integer;
  v_tipo public.field_change_type;
begin
  v_tipo := case tg_op
              when 'INSERT' then 'created'
              when 'UPDATE' then 'updated'
              else 'deleted'
            end::public.field_change_type;

  select coalesce(max(version), 0) + 1 into v_proxima
  from public.field_schema_versions where field_definition_id = v_id;

  insert into public.field_schema_versions (field_definition_id, version, change_type, changed_by)
  values (v_id, v_proxima, v_tipo, auth.uid());

  return coalesce(new, old);
end;
$$;

create trigger field_definitions_versionamento
  after insert or update or delete on public.field_definitions
  for each row execute function app.version_field_definition();

-- ---------------------------------------------------------------------
-- 5. Validacao de custom_fields
-- ---------------------------------------------------------------------
-- A validacao vive no banco, e nao apenas na interface, por dois motivos:
-- o cliente escreve direto via PostgREST (a RLS ja o autoriza), e uma
-- automacao ou importacao futura precisa esbarrar na mesma regra.
create or replace function app.validate_custom_fields(
  p_workspace_id   uuid,
  p_entity_kind    public.entity_kind,
  p_object_type_id uuid,
  p_custom_fields  jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r_def record;
  v_chave text;
  v_valor jsonb;
  v_item jsonb;
begin
  if p_custom_fields is null or jsonb_typeof(p_custom_fields) <> 'object' then
    raise exception 'custom_fields deve ser um objeto jsonb' using errcode = '22023';
  end if;

  -- 5.1 Nenhuma chave desconhecida. Sem isso, um erro de digitacao vira um
  -- campo fantasma que nunca aparece na interface e nunca e encontrado.
  for v_chave in select jsonb_object_keys(p_custom_fields) loop
    if not exists (
      select 1 from public.field_definitions fd
      where fd.workspace_id = p_workspace_id
        and fd.entity_kind = p_entity_kind
        and fd.object_type_id is not distinct from p_object_type_id
        and fd.key = v_chave
    ) then
      raise exception 'campo desconhecido em custom_fields: %', v_chave using errcode = '23514';
    end if;
  end loop;

  -- 5.2 Obrigatoriedade e tipo
  for r_def in
    select * from public.field_definitions fd
    where fd.workspace_id = p_workspace_id
      and fd.entity_kind = p_entity_kind
      and fd.object_type_id is not distinct from p_object_type_id
  loop
    v_valor := p_custom_fields -> r_def.key;

    if v_valor is null or jsonb_typeof(v_valor) = 'null' then
      if r_def.is_required then
        raise exception 'campo obrigatorio ausente: %', r_def.key using errcode = '23502';
      end if;
      continue;
    end if;

    case r_def.field_type
      when 'text', 'ai_generated' then
        if jsonb_typeof(v_valor) <> 'string' then
          raise exception 'campo % espera texto', r_def.key using errcode = '22023';
        end if;

      when 'number', 'currency' then
        if jsonb_typeof(v_valor) <> 'number' then
          raise exception 'campo % espera numero', r_def.key using errcode = '22023';
        end if;

      when 'boolean' then
        if jsonb_typeof(v_valor) <> 'boolean' then
          raise exception 'campo % espera booleano', r_def.key using errcode = '22023';
        end if;

      when 'date' then
        begin
          perform (v_valor #>> '{}')::timestamptz;
        exception when others then
          raise exception 'campo % espera data valida', r_def.key using errcode = '22023';
        end;

      when 'email' then
        if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
          raise exception 'campo % espera e-mail valido', r_def.key using errcode = '22023';
        end if;

      when 'phone' then
        -- Deliberadamente permissivo: numero brasileiro aparece em varios
        -- formatos, e recusar cadastro por causa de mascara e pior do que
        -- guardar com formatacao livre.
        if jsonb_typeof(v_valor) <> 'string' or (v_valor #>> '{}') !~ '^[0-9()+\-\s.]{8,20}$' then
          raise exception 'campo % espera telefone valido', r_def.key using errcode = '22023';
        end if;

      when 'relation' then
        begin
          perform (v_valor #>> '{}')::uuid;
        exception when others then
          raise exception 'campo % espera um identificador', r_def.key using errcode = '22023';
        end;

      when 'select' then
        if not (r_def.options @> jsonb_build_array(v_valor)) then
          raise exception 'valor fora das opcoes do campo %', r_def.key using errcode = '23514';
        end if;

      when 'multiselect' then
        if jsonb_typeof(v_valor) <> 'array' then
          raise exception 'campo % espera uma lista', r_def.key using errcode = '22023';
        end if;
        for v_item in select * from jsonb_array_elements(v_valor) loop
          if not (r_def.options @> jsonb_build_array(v_item)) then
            raise exception 'valor fora das opcoes do campo %', r_def.key using errcode = '23514';
          end if;
        end loop;
    end case;
  end loop;
end;
$$;

revoke all on function app.validate_custom_fields(uuid, public.entity_kind, uuid, jsonb) from public, anon;
grant execute on function app.validate_custom_fields(uuid, public.entity_kind, uuid, jsonb) to authenticated, service_role;

-- Gatilho generico: descobre entity_kind pelo nome da tabela.
create or replace function app.enforce_custom_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.entity_kind;
  v_object_type_id uuid := null;
begin
  v_kind := case tg_table_name
              when 'contacts' then 'contact'
              when 'companies' then 'company'
              when 'deals' then 'deal'
              when 'object_records' then 'object_type'
            end::public.entity_kind;

  if tg_table_name = 'object_records' then
    v_object_type_id := new.object_type_id;
  end if;

  perform app.validate_custom_fields(new.workspace_id, v_kind, v_object_type_id, new.custom_fields);
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Auditoria das entidades (reuso da Etapa 2)
-- ---------------------------------------------------------------------
-- custom_fields pode conter dado classificado como pii ou financial. O
-- ADR-0008 ja registrava que tabelas com coluna sensivel precisam filtrar
-- antes de gravar na trilha. Aqui a trilha guarda as chaves preenchidas, e
-- nao os valores: fica sabendo que o campo mudou, sem copiar o conteudo.
create or replace function app.audit_registro_crm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := null;
  v_after  jsonb := null;
  v_id uuid := coalesce(new.id, old.id);
  v_ws uuid := coalesce(new.workspace_id, old.workspace_id);
begin
  if old is not null then
    v_before := to_jsonb(old) - 'custom_fields'
             || jsonb_build_object('custom_fields_keys',
                  coalesce((select jsonb_agg(k) from jsonb_object_keys(old.custom_fields) k), '[]'::jsonb));
  end if;

  if new is not null then
    v_after := to_jsonb(new) - 'custom_fields'
            || jsonb_build_object('custom_fields_keys',
                 coalesce((select jsonb_agg(k) from jsonb_object_keys(new.custom_fields) k), '[]'::jsonb));
  end if;

  perform app.record_audit(
    v_ws,
    tg_table_name || '.' || lower(tg_op),
    tg_table_name,
    v_id,
    v_before,
    v_after
  );

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. contacts
-- ---------------------------------------------------------------------
create table public.contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  email         text,
  phone         text,
  owner_id      uuid references auth.users (id) on delete set null,
  source        text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index contacts_workspace_id_idx on public.contacts (workspace_id);
create index contacts_owner_idx on public.contacts (workspace_id, owner_id);
create index contacts_email_idx on public.contacts (workspace_id, lower(email)) where email is not null;
create index contacts_custom_fields_gin on public.contacts using gin (custom_fields jsonb_path_ops);

create trigger contacts_valida_custom_fields
  before insert or update on public.contacts
  for each row execute function app.enforce_custom_fields();

create trigger contacts_audit
  after insert or update or delete on public.contacts
  for each row execute function app.audit_registro_crm();

-- ---------------------------------------------------------------------
-- 8. companies
-- ---------------------------------------------------------------------
create table public.companies (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 200),
  domain        text,
  owner_id      uuid references auth.users (id) on delete set null,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index companies_workspace_id_idx on public.companies (workspace_id);
create index companies_owner_idx on public.companies (workspace_id, owner_id);
create index companies_domain_idx on public.companies (workspace_id, lower(domain)) where domain is not null;
create index companies_custom_fields_gin on public.companies using gin (custom_fields jsonb_path_ops);

create trigger companies_valida_custom_fields
  before insert or update on public.companies
  for each row execute function app.enforce_custom_fields();

create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function app.audit_registro_crm();

-- ---------------------------------------------------------------------
-- 9. deals
-- ---------------------------------------------------------------------
create table public.deals (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  title         text not null check (length(btrim(title)) between 1 and 200),
  value         numeric(18, 2) check (value >= 0),
  currency      char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  contact_id    uuid references public.contacts (id) on delete set null,
  company_id    uuid references public.companies (id) on delete set null,
  owner_id      uuid references auth.users (id) on delete set null,
  custom_fields jsonb not null default '{}'::jsonb,
  status        public.deal_status not null default 'open',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.deals.currency is 'BRL por padrao, moeda base da plataforma. O campo existe para operacoes pontuais em outra moeda.';
comment on column public.deals.value is 'Preenchido diretamente nesta etapa. Itens de negocio (deal_line_items) sao da Etapa 4 e ainda nao alteram este valor.';

create index deals_workspace_id_idx on public.deals (workspace_id);
create index deals_owner_idx on public.deals (workspace_id, owner_id);
create index deals_status_idx on public.deals (workspace_id, status);
create index deals_contact_idx on public.deals (contact_id) where contact_id is not null;
create index deals_company_idx on public.deals (company_id) where company_id is not null;
create index deals_custom_fields_gin on public.deals using gin (custom_fields jsonb_path_ops);

create trigger deals_valida_custom_fields
  before insert or update on public.deals
  for each row execute function app.enforce_custom_fields();

create trigger deals_audit
  after insert or update or delete on public.deals
  for each row execute function app.audit_registro_crm();

-- ---------------------------------------------------------------------
-- 10. contact_company_links (N:N sem duplicar cadastro)
-- ---------------------------------------------------------------------
create table public.contact_company_links (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role       text,
  primary key (contact_id, company_id)
);

create index contact_company_links_company_idx on public.contact_company_links (company_id);

comment on table public.contact_company_links is 'Uma pessoa pode atuar em varias empresas e uma empresa tem varios contatos, sem duplicar nenhum dos dois cadastros. Sem workspace_id proprio: o escopo desta etapa define as tres colunas, e o isolamento vem do contato (ver ADR-0013).';

-- ---------------------------------------------------------------------
-- 11. object_types / object_records / object_relations
-- ---------------------------------------------------------------------
create table public.object_types (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name         text not null check (length(btrim(name)) between 1 and 80),
  icon         text,
  description  text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now()
);

create unique index object_types_nome_uniq on public.object_types (workspace_id, lower(name));
create index object_types_workspace_id_idx on public.object_types (workspace_id);

comment on table public.object_types is 'Tipos de registro definidos pelo cliente, sem schema fixo de nicho. Uma imobiliaria cria Imovel; uma escola cria Turma — o produto nao precisa saber a diferenca.';

create table public.object_records (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  object_type_id uuid not null references public.object_types (id) on delete cascade,
  title          text not null check (length(btrim(title)) between 1 and 200),
  owner_id       uuid references auth.users (id) on delete set null,
  custom_fields  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index object_records_workspace_id_idx on public.object_records (workspace_id);
create index object_records_tipo_idx on public.object_records (workspace_id, object_type_id);
create index object_records_owner_idx on public.object_records (workspace_id, owner_id);
create index object_records_custom_fields_gin on public.object_records using gin (custom_fields jsonb_path_ops);

create trigger object_records_valida_custom_fields
  before insert or update on public.object_records
  for each row execute function app.enforce_custom_fields();

create trigger object_records_audit
  after insert or update or delete on public.object_records
  for each row execute function app.audit_registro_crm();

create table public.object_relations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces (id) on delete cascade,
  from_kind      public.entity_kind not null,
  from_id        uuid not null,
  to_kind        public.entity_kind not null,
  to_id          uuid not null,
  relation_label text,
  constraint object_relations_sem_autorreferencia check (not (from_kind = to_kind and from_id = to_id))
);

-- Relacao polimorfica: from_id/to_id nao tem FK porque apontam para quatro
-- tabelas diferentes. A integridade e garantida pelo gatilho abaixo, que
-- confere a existencia do alvo dentro do mesmo workspace.
create unique index object_relations_uniq
  on public.object_relations (workspace_id, from_kind, from_id, to_kind, to_id, coalesce(relation_label, ''));
create index object_relations_workspace_id_idx on public.object_relations (workspace_id);
create index object_relations_origem_idx on public.object_relations (workspace_id, from_kind, from_id);
create index object_relations_destino_idx on public.object_relations (workspace_id, to_kind, to_id);

create or replace function app.check_relation_target(p_workspace_id uuid, p_kind public.entity_kind, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_existe boolean;
begin
  case p_kind
    when 'contact' then
      select exists(select 1 from public.contacts t where t.id = p_id and t.workspace_id = p_workspace_id) into v_existe;
    when 'company' then
      select exists(select 1 from public.companies t where t.id = p_id and t.workspace_id = p_workspace_id) into v_existe;
    when 'deal' then
      select exists(select 1 from public.deals t where t.id = p_id and t.workspace_id = p_workspace_id) into v_existe;
    when 'object_type' then
      select exists(select 1 from public.object_records t where t.id = p_id and t.workspace_id = p_workspace_id) into v_existe;
  end case;
  return coalesce(v_existe, false);
end;
$$;

revoke all on function app.check_relation_target(uuid, public.entity_kind, uuid) from public, anon;
grant execute on function app.check_relation_target(uuid, public.entity_kind, uuid) to authenticated, service_role;

create or replace function app.enforce_relation_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.check_relation_target(new.workspace_id, new.from_kind, new.from_id) then
    raise exception 'origem da relacao nao existe neste workspace' using errcode = '23503';
  end if;
  if not app.check_relation_target(new.workspace_id, new.to_kind, new.to_id) then
    raise exception 'destino da relacao nao existe neste workspace' using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger object_relations_valida_alvos
  before insert or update on public.object_relations
  for each row execute function app.enforce_relation_targets();

-- ---------------------------------------------------------------------
-- 12. RLS
-- ---------------------------------------------------------------------
alter table public.field_definitions      enable row level security;
alter table public.field_definitions      force row level security;
alter table public.field_schema_versions  enable row level security;
alter table public.field_schema_versions  force row level security;
alter table public.contacts               enable row level security;
alter table public.contacts               force row level security;
alter table public.companies              enable row level security;
alter table public.companies              force row level security;
alter table public.deals                  enable row level security;
alter table public.deals                  force row level security;
alter table public.contact_company_links  enable row level security;
alter table public.contact_company_links  force row level security;
alter table public.object_types           enable row level security;
alter table public.object_types           force row level security;
alter table public.object_records         enable row level security;
alter table public.object_records         force row level security;
alter table public.object_relations       enable row level security;
alter table public.object_relations       force row level security;

-- Tabelas com workspace_id proprio: politica direta de membro ativo.
create policy field_definitions_tenant on public.field_definitions for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy contacts_tenant on public.contacts for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy companies_tenant on public.companies for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy deals_tenant on public.deals for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy object_types_tenant on public.object_types for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy object_records_tenant on public.object_records for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy object_relations_tenant on public.object_relations for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Tabelas filhas, cujo escopo nao define workspace_id: o isolamento vem do
-- pai. Ver ADR-0013.
create policy contact_company_links_tenant on public.contact_company_links for all to authenticated
  using (exists (
    select 1 from public.contacts c
    where c.id = contact_id and app.is_workspace_member(c.workspace_id)
  ))
  with check (exists (
    select 1 from public.contacts c
    join public.companies e on e.workspace_id = c.workspace_id
    where c.id = contact_id and e.id = company_id and app.is_workspace_member(c.workspace_id)
  ));

-- Historico de schema: leitura para membro ativo; escrita so pelo gatilho.
create policy field_schema_versions_select on public.field_schema_versions for select to authenticated
  using (exists (
    select 1 from public.field_definitions fd
    where fd.id = field_definition_id and app.is_workspace_member(fd.workspace_id)
  ));

-- ---------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------
revoke all on table public.field_definitions, public.field_schema_versions,
  public.contacts, public.companies, public.deals, public.contact_company_links,
  public.object_types, public.object_records, public.object_relations
  from anon, authenticated;

grant select, insert, update, delete on table
  public.field_definitions, public.contacts, public.companies, public.deals,
  public.contact_company_links, public.object_types, public.object_records,
  public.object_relations
  to authenticated;

-- field_schema_versions e escrita apenas pelo gatilho: historico nao se edita.
grant select on table public.field_schema_versions to authenticated;
