-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 5: canais, conversas e mensagens
--
-- Uma conversa pertence a exatamente um channel_account; um contato pode
-- ter conversas simultaneas em canais diferentes. Por isso o vinculo com o
-- canal esta em conversations, e nao em contacts.
-- =====================================================================

create type public.channel_type as enum
  ('whatsapp','instagram','messenger','telegram','email','webchat','sms','voice');
create type public.channel_account_status as enum ('active','quality_issue','disconnected');
create type public.conversation_status as enum ('open','pending','resolved');
create type public.message_direction as enum ('inbound','outbound');
create type public.message_sender_type as enum ('contact','agent','bot','system');
create type public.message_media_type as enum ('text','image','audio','video','document','location');
create type public.message_delivery_status as enum ('queued','sent','delivered','read','failed');
create type public.channel_quality_event_type as enum ('quality_drop','ban_risk','reconnect_needed');
create type public.note_related_kind as enum ('contact','deal','company');
create type public.summary_origin as enum ('manual','auto_on_resolve');
create type public.reactor_type as enum ('contact','agent');

create table public.channel_accounts (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces (id) on delete cascade,
  channel_type        public.channel_type not null,
  external_account_id text,
  display_name        text not null check (length(btrim(display_name)) between 1 and 120),
  credentials         text,
  status              public.channel_account_status not null default 'disconnected',
  created_at          timestamptz not null default now()
);

comment on column public.channel_accounts.credentials is 'Sempre cifrado (AES-256-GCM, formato v1:iv:tag:dados) pela primitiva do worker. Nunca texto plano. Para whatsapp guarda o Account SID e o Auth Token da SUBCONTA Twilio — jamais login de painel.';
comment on column public.channel_accounts.external_account_id is 'Identificador do lado do provedor: WABA ID, page ID, chat ID do bot etc.';

create index channel_accounts_workspace_id_idx on public.channel_accounts (workspace_id);
create index channel_accounts_tipo_idx on public.channel_accounts (workspace_id, channel_type, status);
create unique index channel_accounts_externo_uniq
  on public.channel_accounts (channel_type, external_account_id)
  where external_account_id is not null;

-- Credencial em texto plano e o acidente mais provavel desta etapa: basta
-- alguem gravar direto pelo painel. A checagem rejeita qualquer valor que
-- nao tenha o prefixo do formato cifrado.
alter table public.channel_accounts
  add constraint channel_accounts_credenciais_cifradas
  check (credentials is null or credentials ~ '^v[0-9]+:');

create table public.agent_numbers (
  id                 uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts (id) on delete cascade,
  agent_id           uuid references auth.users (id) on delete set null,
  phone_number       text not null,
  constraint agent_numbers_uniq unique (channel_account_id, phone_number)
);
create index agent_numbers_conta_idx on public.agent_numbers (channel_account_id);
create index agent_numbers_agente_idx on public.agent_numbers (agent_id);

comment on table public.agent_numbers is 'Multiplos numeros e agentes por conta de canal. O numero e corporativo, operado pela plataforma — nunca o WhatsApp pessoal do vendedor.';

create table public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid not null references public.channel_accounts (id) on delete restrict,
  contact_id         uuid references public.contacts (id) on delete set null,
  company_id         uuid references public.companies (id) on delete set null,
  deal_id            uuid references public.deals (id) on delete set null,
  status             public.conversation_status not null default 'open',
  assigned_to        uuid references auth.users (id) on delete set null,
  is_bot_active      boolean not null default true,
  last_message_at    timestamptz,
  sla_due_at         timestamptz,
  created_at         timestamptz not null default now()
);

create index conversations_workspace_id_idx on public.conversations (workspace_id);
create index conversations_fila_idx on public.conversations (workspace_id, status, last_message_at desc);
create index conversations_responsavel_idx on public.conversations (workspace_id, assigned_to, status);
create index conversations_contato_idx on public.conversations (contact_id) where contact_id is not null;
create index conversations_conta_idx on public.conversations (channel_account_id);
create index conversations_sla_idx on public.conversations (workspace_id, sla_due_at) where status <> 'resolved';

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.conversations (id) on delete cascade,
  direction           public.message_direction not null,
  sender_type         public.message_sender_type not null,
  content             text,
  media_url           text,
  media_type          public.message_media_type not null default 'text',
  duration_seconds    integer check (duration_seconds is null or duration_seconds >= 0),
  transcript          text,
  external_message_id text,
  delivery_status     public.message_delivery_status not null default 'queued',
  error_reason        text,
  created_at          timestamptz not null default now()
);

create index messages_conversa_idx on public.messages (conversation_id, created_at desc);
create index messages_status_idx on public.messages (delivery_status) where delivery_status in ('queued','failed');
-- Deduplicacao de reentrega do provedor: o mesmo evento nao vira duas mensagens.
create unique index messages_externo_uniq on public.messages (external_message_id)
  where external_message_id is not null;
create index messages_transcricao_pendente_idx on public.messages (conversation_id)
  where media_type = 'audio' and transcript is null;

comment on column public.messages.error_reason is 'Motivo legivel da falha. Mensagem de WhatsApp fora da janela permitida falha aqui, com texto explicito, em vez de sumir.';

create table public.message_templates (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces (id) on delete cascade,
  channel_account_id uuid references public.channel_accounts (id) on delete cascade,
  name               text not null,
  body               text not null,
  approval_status    text not null default 'pending',
  category           text
);
create index message_templates_workspace_id_idx on public.message_templates (workspace_id);
create index message_templates_conta_idx on public.message_templates (channel_account_id);

create table public.channel_quality_events (
  id                 uuid primary key default gen_random_uuid(),
  channel_account_id uuid not null references public.channel_accounts (id) on delete cascade,
  event_type         public.channel_quality_event_type not null,
  detail             text,
  created_at         timestamptz not null default now()
);
create index channel_quality_events_conta_idx on public.channel_quality_events (channel_account_id, created_at desc);

create table public.voice_calls (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations (id) on delete cascade,
  direction        public.message_direction not null,
  from_number      text,
  to_number        text,
  agent_id         uuid references auth.users (id) on delete set null,
  recording_url    text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript       text,
  ivr_path         text,
  created_at       timestamptz not null default now()
);
create index voice_calls_conversa_idx on public.voice_calls (conversation_id, created_at desc);

comment on table public.voice_calls is 'Schema apenas. A operacao de voz (Twilio Voice, URA, filas) e da Etapa 6 e nao existe nesta.';

create table public.sla_policies (
  id                     uuid primary key default gen_random_uuid(),
  workspace_id           uuid not null references public.workspaces (id) on delete cascade,
  channel_type           public.channel_type not null,
  first_response_minutes integer check (first_response_minutes is null or first_response_minutes > 0),
  resolution_minutes     integer check (resolution_minutes is null or resolution_minutes > 0),
  constraint sla_policies_uniq unique (workspace_id, channel_type)
);
create index sla_policies_workspace_id_idx on public.sla_policies (workspace_id);

-- ---------------------------------------------------------------------
-- Gatilhos de comportamento
-- ---------------------------------------------------------------------
-- Uma resposta humana desliga o bot. A regra vive no banco porque a mesma
-- mensagem pode ser enviada pelo cockpit, pela fila do worker ou por uma
-- integracao futura — e em todas o operador espera que o bot se cale.
create or replace function app.processar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tipo public.channel_type;
  v_sla integer;
begin
  select c.workspace_id, ca.channel_type into v_ws, v_tipo
  from public.conversations c
  join public.channel_accounts ca on ca.id = c.channel_account_id
  where c.id = new.conversation_id;

  update public.conversations
     set last_message_at = new.created_at,
         is_bot_active = case
           when new.direction = 'outbound' and new.sender_type = 'agent' then false
           else is_bot_active
         end,
         status = case when new.direction = 'inbound' and status = 'resolved' then 'open' else status end
   where id = new.conversation_id;

  if new.direction = 'inbound' then
    select first_response_minutes into v_sla
      from public.sla_policies where workspace_id = v_ws and channel_type = v_tipo;
    if v_sla is not null then
      update public.conversations
         set sla_due_at = coalesce(sla_due_at, new.created_at + make_interval(mins => v_sla))
       where id = new.conversation_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger messages_processa
  after insert on public.messages
  for each row execute function app.processar_mensagem();

-- Medicao de consumo de transcricao, reusando usage_meter_entries da Etapa 2.
-- Dispara quando a transcricao chega, nao quando o audio chega: o custo e da
-- transcricao.
create or replace function app.medir_transcricao()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_ws uuid;
begin
  if new.transcript is not null and old.transcript is null and new.duration_seconds is not null then
    select c.workspace_id into v_ws from public.conversations c where c.id = new.conversation_id;
    insert into public.usage_meter_entries (workspace_id, metric, quantity, occurred_at)
    values (v_ws, 'audio_transcription_minutes', round(new.duration_seconds / 60.0, 6), now());
  end if;
  return new;
end;
$$;

create trigger messages_medicao
  after update on public.messages
  for each row execute function app.medir_transcricao();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.channel_accounts enable row level security;
alter table public.channel_accounts force row level security;
alter table public.agent_numbers enable row level security;
alter table public.agent_numbers force row level security;
alter table public.conversations enable row level security;
alter table public.conversations force row level security;
alter table public.messages enable row level security;
alter table public.messages force row level security;
alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;
alter table public.channel_quality_events enable row level security;
alter table public.channel_quality_events force row level security;
alter table public.voice_calls enable row level security;
alter table public.voice_calls force row level security;
alter table public.sla_policies enable row level security;
alter table public.sla_policies force row level security;

create policy channel_accounts_tenant on public.channel_accounts for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));
create policy conversations_tenant on public.conversations for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));
create policy message_templates_tenant on public.message_templates for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));
create policy sla_policies_tenant on public.sla_policies for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

-- Filhas: isolamento derivado do pai (ADR-0013).
create policy agent_numbers_tenant on public.agent_numbers for all to authenticated
  using (exists (select 1 from public.channel_accounts a where a.id = channel_account_id and app.is_workspace_member(a.workspace_id)))
  with check (exists (select 1 from public.channel_accounts a where a.id = channel_account_id and app.is_workspace_member(a.workspace_id)));

create policy messages_tenant on public.messages for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)));

create policy channel_quality_events_tenant on public.channel_quality_events for all to authenticated
  using (exists (select 1 from public.channel_accounts a where a.id = channel_account_id and app.is_workspace_member(a.workspace_id)))
  with check (exists (select 1 from public.channel_accounts a where a.id = channel_account_id and app.is_workspace_member(a.workspace_id)));

create policy voice_calls_tenant on public.voice_calls for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)));

revoke all on table public.channel_accounts, public.agent_numbers, public.conversations,
  public.messages, public.message_templates, public.channel_quality_events,
  public.voice_calls, public.sla_policies from anon, authenticated;

grant select, insert, update, delete on table public.agent_numbers, public.conversations,
  public.messages, public.message_templates, public.channel_quality_events,
  public.voice_calls, public.sla_policies to authenticated;

-- credentials nunca deve chegar ao browser: o GRANT e por coluna, e a coluna
-- cifrada fica de fora.
grant select (id, workspace_id, channel_type, external_account_id, display_name, status, created_at)
  on public.channel_accounts to authenticated;
grant insert (workspace_id, channel_type, external_account_id, display_name, status)
  on public.channel_accounts to authenticated;
grant update (external_account_id, display_name, status) on public.channel_accounts to authenticated;
grant delete on public.channel_accounts to authenticated;
