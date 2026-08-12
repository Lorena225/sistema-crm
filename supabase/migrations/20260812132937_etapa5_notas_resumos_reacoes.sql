-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 5: notas, resumos de conversa e reacoes
-- =====================================================================

create table public.notes (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces (id) on delete cascade,
  related_to_type public.note_related_kind not null,
  related_to_id   uuid not null,
  author_id       uuid references auth.users (id) on delete set null,
  body            text not null check (length(btrim(body)) > 0),
  is_pinned       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index notes_workspace_id_idx on public.notes (workspace_id);
create index notes_relacionado_idx on public.notes (workspace_id, related_to_type, related_to_id, created_at desc);
create index notes_fixadas_idx on public.notes (workspace_id, related_to_type, related_to_id) where is_pinned;

comment on table public.notes is 'Notas de contato, negocio ou empresa. E a tabela que a fila offline da Etapa 2 esperava: a partir daqui a operacao nota.criar passa a ter destino.';

create table public.conversation_summaries (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  summary_text    text not null,
  key_points      jsonb not null default '[]'::jsonb,
  generated_at    timestamptz not null default now(),
  generated_by    public.summary_origin not null default 'manual'
);

create index conversation_summaries_conversa_idx
  on public.conversation_summaries (conversation_id, generated_at desc);
create index conversation_summaries_pontos_gin
  on public.conversation_summaries using gin (key_points jsonb_path_ops);

create table public.message_reactions (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.messages (id) on delete cascade,
  reactor_type public.reactor_type not null,
  reactor_id   uuid,
  emoji        text not null,
  created_at   timestamptz not null default now(),
  constraint message_reactions_uniq unique (message_id, reactor_type, reactor_id, emoji)
);
create index message_reactions_mensagem_idx on public.message_reactions (message_id);

-- ---------------------------------------------------------------------
-- Resumo ao resolver
-- ---------------------------------------------------------------------
-- workspaces.auto_summary_on_resolve foi criada na Etapa 1 esperando por
-- este momento. O gatilho enfileira a marcacao; quem escreve o texto e a
-- runtime de IA (Etapa 8). Ate la o resumo automatico nasce com um marcador
-- explicito, em vez de um texto inventado.
create or replace function app.resumir_ao_resolver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auto boolean;
  v_linhas integer;
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    select w.auto_summary_on_resolve into v_auto
      from public.workspaces w where w.id = new.workspace_id;

    if coalesce(v_auto, true) then
      select count(*) into v_linhas from public.messages m where m.conversation_id = new.id;

      insert into public.conversation_summaries (conversation_id, summary_text, key_points, generated_by)
      values (
        new.id,
        'Resumo automatico pendente de geracao.',
        jsonb_build_object('mensagens', v_linhas, 'resolvida_em', now()),
        'auto_on_resolve'
      );
    end if;
  end if;
  return new;
end;
$$;

create trigger conversations_resumo
  after update on public.conversations
  for each row execute function app.resumir_ao_resolver();

comment on function app.resumir_ao_resolver is 'Le a flag global workspaces.auto_summary_on_resolve. Alterar essa flag e prerrogativa de Owner/Admin e so ganha interface na Etapa 9.';

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.notes enable row level security;
alter table public.notes force row level security;
alter table public.conversation_summaries enable row level security;
alter table public.conversation_summaries force row level security;
alter table public.message_reactions enable row level security;
alter table public.message_reactions force row level security;

create policy notes_tenant on public.notes for all to authenticated
  using (app.is_workspace_member(workspace_id)) with check (app.is_workspace_member(workspace_id));

create policy conversation_summaries_tenant on public.conversation_summaries for all to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (select 1 from public.conversations c where c.id = conversation_id and app.is_workspace_member(c.workspace_id)));

create policy message_reactions_tenant on public.message_reactions for all to authenticated
  using (exists (
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.id = message_id and app.is_workspace_member(c.workspace_id)))
  with check (exists (
    select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
    where m.id = message_id and app.is_workspace_member(c.workspace_id)));

revoke all on table public.notes, public.conversation_summaries, public.message_reactions
  from anon, authenticated;
grant select, insert, update, delete on table
  public.notes, public.conversation_summaries, public.message_reactions to authenticated;
