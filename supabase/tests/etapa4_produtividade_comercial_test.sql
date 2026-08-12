-- =====================================================================
-- Teste reproduzivel da Etapa 4: tarefas, agendamento publico, campanhas,
-- identidade e motor comercial.
--
--   supabase db execute --file supabase/tests/etapa4_produtividade_comercial_test.sql
--
-- Transacao encerrada em ROLLBACK: nao deixa residuo.
-- =====================================================================

begin;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated','e4a@t.local','x',now(),now(),now(),'{}','{}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000002','authenticated','authenticated','e4b@t.local','x',now(),now(),now(),'{}','{}');

create temp table r(id serial, nome text, resultado text) on commit drop;
grant all on table r to authenticated, anon;
grant all on sequence r_id_seq to authenticated, anon;

select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated; select public.create_workspace('WS A','e4-a'); reset role;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
set local role authenticated; select public.create_workspace('WS B','e4-b'); reset role;

-- ============ Motor comercial ============
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_ws uuid; v_prod uuid; v_prod2 uuid; v_pb uuid; v_deal uuid;
  v_item uuid; v_item2 uuid; v_val numeric; v_lt numeric; v_moeda text;
begin
  select id into v_ws from public.workspaces where slug='e4-a';

  insert into public.products (workspace_id, name, sku, default_price)
  values (v_ws,'Plano Essencial','ESS',199.90) returning id into v_prod;
  insert into public.products (workspace_id, name, sku, default_price)
  values (v_ws,'Implantacao','IMP',1000.00) returning id into v_prod2;

  select currency into v_moeda from public.products where id=v_prod;
  insert into r(nome,resultado) values ('Produto nasce em BRL',
    format('%s | %s', v_moeda, case when btrim(v_moeda)='BRL' then 'PASS' else 'FAIL' end));

  insert into public.price_books (workspace_id, name, is_default) values (v_ws,'Tabela 2026',true) returning id into v_pb;
  insert into public.price_book_entries (price_book_id, product_id, unit_price) values (v_pb, v_prod, 149.90);

  insert into public.deals (workspace_id, title) values (v_ws,'Negocio com itens') returning id into v_deal;

  -- Entrada especifica do price book tem precedencia sobre o preco padrao
  insert into public.deal_line_items (deal_id, product_id, price_book_id, quantity)
  values (v_deal, v_prod, v_pb, 2) returning id into v_item;
  select unit_price, line_total into v_lt, v_val from public.deal_line_items where id=v_item;
  insert into r(nome,resultado) values ('Entrada do price book vence o preco padrao',
    format('unit=%s total=%s (esperado 149.90 / 299.80) | %s', v_lt, v_val,
      case when v_lt=149.90 and v_val=299.80 then 'PASS' else 'FAIL' end));

  -- Sem entrada, cai no preco padrao do produto
  insert into public.deal_line_items (deal_id, product_id, price_book_id, quantity)
  values (v_deal, v_prod2, v_pb, 1) returning id into v_item2;
  select unit_price into v_lt from public.deal_line_items where id=v_item2;
  insert into r(nome,resultado) values ('Sem entrada usa products.default_price',
    format('unit=%s (esperado 1000.00) | %s', v_lt, case when v_lt=1000.00 then 'PASS' else 'FAIL' end));

  select value into v_val from public.deals where id=v_deal;
  insert into r(nome,resultado) values ('deals.value recalculado na criacao',
    format('%s (esperado 1299.80) | %s', v_val, case when v_val=1299.80 then 'PASS' else 'FAIL' end));

  update public.deal_line_items set discount_percent = 0.10 where id=v_item;
  select line_total into v_lt from public.deal_line_items where id=v_item;
  select value into v_val from public.deals where id=v_deal;
  insert into r(nome,resultado) values ('Desconto aplica (1 - discount_percent)',
    format('linha=%s negocio=%s (esperado 269.82 / 1269.82) | %s', v_lt, v_val,
      case when v_lt=269.82 and v_val=1269.82 then 'PASS' else 'FAIL' end));

  delete from public.deal_line_items where id=v_item2;
  select value into v_val from public.deals where id=v_deal;
  insert into r(nome,resultado) values ('deals.value recalculado na remocao',
    format('%s (esperado 269.82) | %s', v_val, case when v_val=269.82 then 'PASS' else 'FAIL' end));

  update public.deals set value = 999999 where id=v_deal;
  select value into v_val from public.deals where id=v_deal;
  insert into r(nome,resultado) values ('Com itens, valor manual e sobreposto',
    format('%s (esperado 269.82) | %s', v_val, case when v_val=269.82 then 'PASS' else 'FAIL' end));

  delete from public.deal_line_items where deal_id=v_deal;
  update public.deals set value = 5000 where id=v_deal;
  select value into v_val from public.deals where id=v_deal;
  insert into r(nome,resultado) values ('Sem itens, valor e editavel manualmente',
    format('%s (esperado 5000) | %s', v_val, case when v_val=5000 then 'PASS' else 'FAIL' end));
end $$;
reset role;

-- ============ Agendamento publico ============
do $$
declare v_ws uuid; v_tt uuid; v_bp uuid;
begin
  select id into v_ws from public.workspaces where slug='e4-a';
  insert into public.task_types (workspace_id, code, name, category, requires_outcome, default_duration_minutes)
  values (v_ws,'reuniao','Reunião comercial','reunião',true,30) returning id into v_tt;
  insert into public.task_outcome_types (workspace_id, task_type_id, code, label)
  values (v_ws,v_tt,'compareceu','Compareceu');
  insert into public.booking_pages (workspace_id, user_id, slug, title, default_duration_minutes, buffer_between_meetings, task_type_id)
  values (v_ws,'aaaaaaaa-0000-4000-8000-000000000001','lorena-reuniao','Reunião com Lorena',30,15,v_tt)
  returning id into v_bp;
  insert into public.booking_slots (booking_page_id, date, start_time, end_time)
  values (v_bp, (now() + interval '1 day')::date, '09:00', '12:00');
end $$;

-- Visitante sem sessao
select set_config('request.jwt.claims','', true);
set local role anon;

do $$
declare v_t uuid; v_base timestamptz; v_cnt int;
begin
  v_base := ((now() + interval '1 day')::date + time '10:00') at time zone 'America/Sao_Paulo';

  begin
    v_t := public.create_public_booking('lorena-reuniao', v_base, 'Cliente Um', 'um@ex.com', '61999990000', 'primeira conversa', true);
    insert into r(nome,resultado) values ('Visitante anonimo agenda', case when v_t is not null then 'PASS' else 'FAIL' end);
  exception when others then
    insert into r(nome,resultado) values ('Visitante anonimo agenda', format('erro %s: %s | FAIL', sqlstate, sqlerrm));
  end;

  begin
    v_t := public.create_public_booking('lorena-reuniao', v_base + interval '20 minutes', 'Cliente Dois');
    insert into r(nome,resultado) values ('Buffer de 15 min recusa horario colado','aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Buffer de 15 min recusa horario colado', format('recusado (%s) | PASS', sqlstate));
  end;

  begin
    v_t := public.create_public_booking('lorena-reuniao',
      ((now()+interval '1 day')::date + time '13:00') at time zone 'America/Sao_Paulo','Cliente Tres');
    insert into r(nome,resultado) values ('Horario fora da janela','aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Horario fora da janela', format('recusado (%s) | PASS', sqlstate));
  end;

  begin
    v_t := public.create_public_booking('lorena-reuniao',
      ((now()+interval '1 day')::date + time '11:00') at time zone 'America/Sao_Paulo','Cliente Quatro','quatro@ex.com');
    insert into r(nome,resultado) values ('Horario livre depois do buffer', case when v_t is not null then 'PASS' else 'FAIL' end);
  exception when others then
    insert into r(nome,resultado) values ('Horario livre depois do buffer', format('erro %s | FAIL', sqlstate));
  end;

  -- O visitante nao alcanca o tenant, so a funcao publica.
  begin
    select count(*) into v_cnt from public.tasks;
    insert into r(nome,resultado) values ('Anonimo le tarefas direto', format('%s | FAIL', v_cnt));
  exception when insufficient_privilege then
    insert into r(nome,resultado) values ('Anonimo le tarefas direto','bloqueado | PASS');
  end;

  select count(*) into v_cnt from public.get_public_booking_page('lorena-reuniao');
  insert into r(nome,resultado) values ('Pagina publica legivel pela funcao',
    format('%s | %s', v_cnt, case when v_cnt=1 then 'PASS' else 'FAIL' end));
end $$;
reset role;

do $$
declare v_cnt int; v_rel text;
begin
  select count(*) into v_cnt from public.tasks where source='agendamento_publico';
  insert into r(nome,resultado) values ('Reservas criaram tarefas',
    format('%s (esperado 2) | %s', v_cnt, case when v_cnt=2 then 'PASS' else 'FAIL' end));

  select related_to_type::text into v_rel from public.tasks where title like '%Cliente Um%';
  insert into r(nome,resultado) values ('Reserva com negocio vincula ao negocio',
    format('%s | %s', v_rel, case when v_rel='deal' then 'PASS' else 'FAIL' end));

  select count(*) into v_cnt from public.contacts where source='agendamento_publico';
  insert into r(nome,resultado) values ('Reserva cria contato',
    format('%s (esperado 2) | %s', v_cnt, case when v_cnt=2 then 'PASS' else 'FAIL' end));

  select count(*) into v_cnt from public.deals where title like 'Reunião:%';
  insert into r(nome,resultado) values ('Reserva cria negocio quando configurado',
    format('%s (esperado 1) | %s', v_cnt, case when v_cnt=1 then 'PASS' else 'FAIL' end));
end $$;

-- ============ Atraso e calculado ============
do $$
declare v_ws uuid; v_n int;
begin
  select id into v_ws from public.workspaces where slug='e4-a';
  insert into public.tasks (workspace_id, title, due_at, status)
  values (v_ws,'Vencida', now()-interval '2 days','pendente');
  select count(*) into v_n from public.tasks
  where workspace_id=v_ws and due_at<now() and status='pendente';
  insert into r(nome,resultado) values ('Atraso calculado, nao persistido',
    format('%s | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));
end $$;

-- ============ Campanhas e identidade ============
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_ws uuid; v_camp uuid; v_c1 uuid; v_c2 uuid; v_deal uuid; v_n int; v_score numeric;
begin
  select id into v_ws from public.workspaces where slug='e4-a';

  insert into public.campaigns (workspace_id, name, channel, type, budget, utm_source, utm_campaign)
  values (v_ws,'Black Friday','meta','pago',5000.00,'facebook','bf2026') returning id into v_camp;

  select id into v_c1 from public.contacts where email='um@ex.com';
  insert into public.deals (workspace_id, title, contact_id) values (v_ws,'Negocio da campanha',v_c1) returning id into v_deal;
  insert into public.campaign_members (campaign_id, contact_id, deal_id, status) values (v_camp,v_c1,v_deal,'convertido');
  insert into public.campaign_influence (deal_id, campaign_id, influence_type, weight) values (v_deal,v_camp,'primeiro_toque',0.6);

  select count(*) into v_n from public.campaign_members where campaign_id=v_camp;
  insert into r(nome,resultado) values ('Campanha registra membro e influencia',
    format('%s | %s', v_n, case when v_n=1 then 'PASS' else 'FAIL' end));

  -- Duplicidade por e-mail, com grafia diferente
  insert into public.contacts (workspace_id, name, email) values (v_ws,'Cliente Um (dup)','UM@EX.COM') returning id into v_c2;
  insert into public.identity_resolution_rules (workspace_id, match_fields, match_type)
  values (v_ws,'["email","phone","documento"]'::jsonb,'exact');

  perform public.detect_duplicate_contacts(v_ws, v_c2);
  select count(*), max(confidence_score) into v_n, v_score
  from public.identity_merge_queue where status='pending_review';
  insert into r(nome,resultado) values ('Duplicata por e-mail entra na fila revisavel',
    format('%s na fila, score %s | %s', v_n, v_score,
      case when v_n>=1 and v_score=0.90 then 'PASS' else 'FAIL' end));
end $$;
reset role;

-- ============ Isolamento cross-tenant ============
do $$
declare v_ws_a uuid; v_n int;
begin
  select id into v_ws_a from public.workspaces where slug='e4-a';
  perform set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}',true);
  set local role authenticated;

  select count(*) into v_n from public.tasks;
  insert into r(nome,resultado) values ('B nao le tarefas de A',
    format('%s | %s', v_n, case when v_n=0 then 'PASS' else 'FAIL' end));

  select count(*) into v_n from public.campaigns;
  insert into r(nome,resultado) values ('B nao le campanhas de A',
    format('%s | %s', v_n, case when v_n=0 then 'PASS' else 'FAIL' end));

  select count(*) into v_n from public.identity_merge_queue;
  insert into r(nome,resultado) values ('B nao le fila de merge de A',
    format('%s | %s', v_n, case when v_n=0 then 'PASS' else 'FAIL' end));

  begin
    execute format('insert into public.task_types (workspace_id, code, name) values (%L,%L,%L)', v_ws_a,'invasao','Invasao');
    insert into r(nome,resultado) values ('B grava catalogo no workspace de A','gravou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('B grava catalogo no workspace de A',
      format('bloqueado (%s) | %s', sqlstate, case when sqlstate='42501' then 'PASS' else 'FAIL' end));
  end;

  reset role;
end $$;

insert into r(nome,resultado) values ('Controle negativo do harness',
  case when 1=0 then 'PASS' else 'FAIL detectado corretamente (harness funcional)' end);

select nome, resultado from r order by id;

rollback;
