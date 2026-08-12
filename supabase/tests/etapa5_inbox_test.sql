-- =====================================================================
-- Teste reproduzivel da Etapa 5: canais, conversas, mensagens, notas,
-- resumos e reacoes.
--
-- Executar com:
--   supabase db execute --file supabase/tests/etapa5_inbox_test.sql
-- ou colar no SQL Editor do Supabase.
--
-- Roda inteiro em transacao encerrada em ROLLBACK: nao deixa residuo.
-- =====================================================================

begin;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-00000000000a','authenticated','authenticated','e5a@test.local','x',now(),now(),now(),'{}','{}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-00000000000b','authenticated','authenticated','e5b@test.local','x',now(),now(),now(),'{}','{}');

create temp table r(id serial, nome text, resultado text) on commit drop;
grant all on table r to authenticated;
grant all on sequence r_id_seq to authenticated;

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}',true);
set local role authenticated; select public.create_workspace('WS A','e5-a'); reset role;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}',true);
set local role authenticated; select public.create_workspace('WS B','e5-b'); reset role;

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_ws uuid; v_ca uuid; v_ct uuid; v_conv uuid; v_m uuid; v_m2 uuid;
  v_bot boolean; v_st text; v_txt text; v_n int; v_qtd numeric; v_sla timestamptz;
begin
  select id into v_ws from public.workspaces where slug='e5-a';

  -- ============ Credencial: DUAS barreiras distintas ============
  -- Barreira 1 (GRANT por coluna): authenticated nao tem permissao de escrita
  -- em `credentials`. Nem cifrada, nem crua — a coluna simplesmente nao esta
  -- ao alcance do navegador.
  begin
    insert into public.channel_accounts (workspace_id, channel_type, display_name, credentials, status)
    values (v_ws,'whatsapp','Tentativa pelo cliente','v1:aXY:dGFn:Y2lmcmFkbw','active');
    insert into r(nome,resultado) values ('Barreira 1: cliente escreve credentials','gravou | FAIL');
  exception when insufficient_privilege then
    insert into r(nome,resultado) values ('Barreira 1: cliente escreve credentials',
      'bloqueado pelo GRANT por coluna | PASS');
  end;

  -- A conta e criada sem credencial, que e o caminho normal do cliente.
  insert into public.channel_accounts (workspace_id, channel_type, external_account_id, display_name, status)
  values (v_ws,'whatsapp','WABA-1','Numero corporativo','active') returning id into v_ca;
  insert into r(nome,resultado) values ('Conta criada sem credencial pelo cliente','PASS');

  insert into public.agent_numbers (channel_account_id, phone_number) values (v_ca,'+5561999990000');
  insert into public.agent_numbers (channel_account_id, phone_number) values (v_ca,'+5561988887777');
  select count(*) into v_n from public.agent_numbers where channel_account_id=v_ca;
  insert into r(nome,resultado) values ('Multiplos numeros por conta',
    format('%s | esperado 2 | %s', v_n, case when v_n=2 then 'PASS' else 'FAIL' end));

  insert into public.sla_policies (workspace_id, channel_type, first_response_minutes) values (v_ws,'whatsapp',15);
  insert into public.contacts (workspace_id, name, phone) values (v_ws,'Joana','+5561911112222') returning id into v_ct;
  insert into public.conversations (workspace_id, channel_account_id, contact_id) values (v_ws, v_ca, v_ct) returning id into v_conv;

  -- ============ Mensagem recebida ============
  insert into public.messages (conversation_id, direction, sender_type, content, external_message_id)
  values (v_conv,'inbound','contact','Oi, quero informacoes','SM-1') returning id into v_m;

  select is_bot_active, sla_due_at into v_bot, v_sla from public.conversations where id=v_conv;
  insert into r(nome,resultado) values ('Mensagem recebida define SLA',
    format('%s min | esperado 15 | %s', round(extract(epoch from (v_sla - now()))/60),
      case when v_sla is not null then 'PASS' else 'FAIL' end));
  insert into r(nome,resultado) values ('Bot ativo apos mensagem do contato',
    format('%s | %s', v_bot, case when v_bot then 'PASS' else 'FAIL' end));

  -- Reentrega do provedor nao vira mensagem duplicada
  begin
    insert into public.messages (conversation_id, direction, sender_type, content, external_message_id)
    values (v_conv,'inbound','contact','Oi, quero informacoes','SM-1');
    insert into r(nome,resultado) values ('Reentrega do provedor','duplicou | FAIL');
  exception when unique_violation then
    insert into r(nome,resultado) values ('Reentrega do provedor','recusada | PASS');
  end;

  -- ============ Bot ============
  insert into public.messages (conversation_id, direction, sender_type, content)
  values (v_conv,'outbound','bot','Ola! Sou a assistente.');
  select is_bot_active into v_bot from public.conversations where id=v_conv;
  insert into r(nome,resultado) values ('Resposta do bot mantem bot ativo',
    format('%s | %s', v_bot, case when v_bot then 'PASS' else 'FAIL' end));

  insert into public.messages (conversation_id, direction, sender_type, content, delivery_status)
  values (v_conv,'outbound','agent','Oi Joana, aqui e a Lorena','sent');
  select is_bot_active into v_bot from public.conversations where id=v_conv;
  insert into r(nome,resultado) values ('Resposta humana desativa o bot',
    format('%s | esperado false | %s', v_bot, case when v_bot=false then 'PASS' else 'FAIL' end));

  -- ============ Falha explicita e isolada ============
  insert into public.messages (conversation_id, direction, sender_type, content, delivery_status, error_reason)
  values (v_conv,'outbound','agent','Fora da janela','failed',
    'Janela de 24h do WhatsApp expirada: use um template aprovado para reabrir a conversa.')
  returning id into v_m2;
  select delivery_status::text, error_reason into v_st, v_txt from public.messages where id=v_m2;
  insert into r(nome,resultado) values ('Falha registra status e motivo legivel',
    format('%s / "%s" | %s', v_st, left(v_txt,40),
      case when v_st='failed' and v_txt is not null then 'PASS' else 'FAIL' end));

  insert into public.messages (conversation_id, direction, sender_type, content, delivery_status)
  values (v_conv,'outbound','agent','Segue o template','sent');
  select count(*) into v_n from public.messages where conversation_id=v_conv and delivery_status='sent';
  insert into r(nome,resultado) values ('Falha nao bloqueia mensagem seguinte',
    format('%s enviada(s) | %s', v_n, case when v_n>=2 then 'PASS' else 'FAIL' end));

  -- ============ Transcricao mede consumo ============
  insert into public.messages (conversation_id, direction, sender_type, media_type, media_url, duration_seconds)
  values (v_conv,'inbound','contact','audio','https://x/audio.ogg',90) returning id into v_m2;
  update public.messages set transcript='Bom dia, gostaria de saber o valor.' where id=v_m2;
  select quantity into v_qtd from public.usage_meter_entries
   where workspace_id=v_ws and metric='audio_transcription_minutes';
  insert into r(nome,resultado) values ('Transcricao mede consumo',
    format('%s min para 90s | esperado 1.5 | %s', v_qtd, case when v_qtd=1.5 then 'PASS' else 'FAIL' end));

  insert into public.message_reactions (message_id, reactor_type, emoji) values (v_m,'contact','ok');
  select count(*) into v_n from public.message_reactions where message_id=v_m;
  insert into r(nome,resultado) values ('Reacao registrada',
    format('%s | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));

  -- ============ Resumo ao resolver, conforme a flag global ============
  update public.conversations set status='resolved' where id=v_conv;
  select count(*) into v_n from public.conversation_summaries
   where conversation_id=v_conv and generated_by='auto_on_resolve';
  insert into r(nome,resultado) values ('Resolver gera resumo (flag true)',
    format('%s | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));

  update public.workspaces set auto_summary_on_resolve=false where id=v_ws;
  update public.conversations set status='open' where id=v_conv;
  update public.conversations set status='resolved' where id=v_conv;
  select count(*) into v_n from public.conversation_summaries where conversation_id=v_conv;
  insert into r(nome,resultado) values ('Flag desligada nao gera resumo',
    format('%s | esperado 1 | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));

  insert into public.messages (conversation_id, direction, sender_type, content)
  values (v_conv,'inbound','contact','Voltei');
  select status::text into v_st from public.conversations where id=v_conv;
  insert into r(nome,resultado) values ('Contato reabre conversa resolvida',
    format('%s | %s', v_st, case when v_st='open' then 'PASS' else 'FAIL' end));

  -- ============ Mesmo contato em canais simultaneos ============
  insert into public.channel_accounts (workspace_id, channel_type, display_name, status)
  values (v_ws,'instagram','@empresa','active') returning id into v_ca;
  insert into public.conversations (workspace_id, channel_account_id, contact_id) values (v_ws, v_ca, v_ct);
  select count(*) into v_n from public.conversations where contact_id=v_ct;
  insert into r(nome,resultado) values ('Mesmo contato em canais simultaneos',
    format('%s conversas / 1 contato | %s', v_n, case when v_n=2 then 'PASS' else 'FAIL' end));

  insert into public.notes (workspace_id, related_to_type, related_to_id, body, is_pinned)
  values (v_ws,'contact',v_ct,'Cliente pediu retorno na quinta', true);
  select count(*) into v_n from public.notes where related_to_id=v_ct and is_pinned;
  insert into r(nome,resultado) values ('Nota fixada no contato',
    format('%s | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));
end $$;

reset role;

-- ============ Barreira 2: restricao do banco, valendo ate para o servico ==
-- O onboarding grava com service role. Se alguem colar um Auth Token cru ali
-- — ou direto no painel do Supabase — o Postgres recusa pelo formato.
do $$
declare v_ws uuid;
begin
  select id into v_ws from public.workspaces where slug='e5-a';
  begin
    insert into public.channel_accounts (workspace_id, channel_type, display_name, credentials, status)
    values (v_ws,'sms','Token cru pelo servico','AC123:token-em-texto-plano','active');
    insert into r(nome,resultado) values ('Barreira 2: servico grava token cru','gravou | FAIL');
  exception when check_violation then
    insert into r(nome,resultado) values ('Barreira 2: servico grava token cru',
      'recusado pela restricao de formato | PASS');
  end;

  insert into public.channel_accounts (workspace_id, channel_type, display_name, credentials, status)
  values (v_ws,'sms','Token cifrado pelo servico','v1:aXY:dGFn:Y2lmcmFkbw','active');
  insert into r(nome,resultado) values ('Barreira 2: servico grava token cifrado','aceito | PASS');
end $$;

-- ============ Isolamento ============
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}',true);
set local role authenticated;
do $$
declare a int; c int; m int; n int; s int;
begin
  select count(*) into a from public.channel_accounts;
  select count(*) into c from public.conversations;
  select count(*) into m from public.messages;
  select count(*) into n from public.notes;
  select count(*) into s from public.conversation_summaries;
  insert into r(nome,resultado) values ('B nao le inbox de A',
    format('contas=%s conversas=%s msgs=%s notas=%s resumos=%s | %s',
      a,c,m,n,s, case when a+c+m+n+s=0 then 'PASS' else 'FAIL' end));
end $$;
reset role;

-- Escrita cross-tenant com identificador explicito, mirando a tabela filha:
-- `messages` isola pelo pai (ADR-0013), e politica derivada errada falharia
-- em silencio.
do $$
declare v_conv_a uuid; v_ws_a uuid;
begin
  select id into v_ws_a from public.workspaces where slug='e5-a';
  select id into v_conv_a from public.conversations where workspace_id=v_ws_a limit 1;

  perform set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}',true);
  set local role authenticated;
  begin
    execute format(
      'insert into public.messages (conversation_id, direction, sender_type, content) values (%L,%L,%L,%L)',
      v_conv_a, 'outbound', 'agent', 'Invasao');
    insert into r(nome,resultado) values ('B escreve na conversa de A','gravou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('B escreve na conversa de A',
      format('bloqueado (%s) | %s', sqlstate, case when sqlstate='42501' then 'PASS' else 'FAIL' end));
  end;
  reset role;
end $$;

-- ============ Barreira 3: leitura da coluna pelo cliente ============
do $$
declare v_txt text;
begin
  perform set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}',true);
  set local role authenticated;
  begin
    select credentials into v_txt from public.channel_accounts limit 1;
    insert into r(nome,resultado) values ('Barreira 3: cliente le credentials',
      format('leu "%s" | FAIL', v_txt));
  exception when insufficient_privilege then
    insert into r(nome,resultado) values ('Barreira 3: cliente le credentials',
      'bloqueado pelo GRANT por coluna | PASS');
  end;
  reset role;
end $$;

insert into r(nome,resultado) values ('Controle negativo do harness',
  case when 1=0 then 'PASS' else 'FAIL detectado corretamente (harness funcional)' end);

select nome, resultado from r order by id;

rollback;
