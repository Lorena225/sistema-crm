-- =====================================================================
-- Teste reproduzivel da Etapa 3: campos configuraveis, entidades CRM,
-- objetos customizados, relacoes e pipelines paralelos.
--
-- Executar com:
--   supabase db execute --file supabase/tests/etapa3_crm_test.sql
-- ou colar no SQL Editor do Supabase.
--
-- Roda inteiro em transacao encerrada em ROLLBACK: nao deixa residuo.
-- =====================================================================

begin;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated','e3a@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000002','authenticated','authenticated','e3b@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}');

create temp table r(id serial, nome text, resultado text) on commit drop;
grant all on table r to authenticated;
grant all on sequence r_id_seq to authenticated;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('WS A', 'e3-ws-a');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('WS B', 'e3-ws-b');
reset role;

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_ws uuid; v_fd uuid; v_c uuid; v_e uuid; v_e2 uuid; v_deal uuid;
  v_ot uuid; v_or uuid; v_pipe uuid; v_pipe2 uuid;
  v_s1 uuid; v_s2 uuid; v_s3 uuid; v_item uuid;
  v_cnt int; v_dur bigint; v_txt text; v_tem boolean;
begin
  select id into v_ws from public.workspaces where slug = 'e3-ws-a';

  -- ============ Campos configuraveis e versionamento ============
  insert into public.field_definitions (workspace_id, entity_kind, key, label, field_type, is_required, sensitivity_level)
  values (v_ws, 'contact', 'cpf', 'CPF', 'text', true, 'pii') returning id into v_fd;

  insert into public.field_definitions (workspace_id, entity_kind, key, label, field_type, options)
  values (v_ws, 'contact', 'origem', 'Origem', 'select', '["Indicacao","Anuncio"]'::jsonb);

  select count(*) into v_cnt from public.field_schema_versions where field_definition_id = v_fd;
  insert into r(nome,resultado) values ('Criar campo versiona field_schema_versions',
    format('%s versao(oes) | esperado 1 | %s', v_cnt, case when v_cnt=1 then 'PASS' else 'FAIL' end));

  update public.field_definitions set label = 'CPF do titular' where id = v_fd;
  select count(*) into v_cnt from public.field_schema_versions where field_definition_id = v_fd;
  insert into r(nome,resultado) values ('Alterar campo gera nova versao',
    format('%s versoes | esperado 2 | %s', v_cnt, case when v_cnt=2 then 'PASS' else 'FAIL' end));

  -- ============ Validacao de custom_fields ============
  begin
    insert into public.contacts (workspace_id, name, custom_fields) values (v_ws, 'Sem CPF', '{}'::jsonb);
    insert into r(nome,resultado) values ('Campo obrigatorio ausente', 'aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Campo obrigatorio ausente', format('recusado (%s) | PASS', sqlstate));
  end;

  begin
    insert into public.contacts (workspace_id, name, custom_fields)
    values (v_ws, 'Chave fantasma', '{"cpf":"1","inexistente":"x"}'::jsonb);
    insert into r(nome,resultado) values ('Chave desconhecida', 'aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Chave desconhecida', format('recusado (%s) | PASS', sqlstate));
  end;

  begin
    insert into public.contacts (workspace_id, name, custom_fields)
    values (v_ws, 'Opcao invalida', '{"cpf":"1","origem":"Feira"}'::jsonb);
    insert into r(nome,resultado) values ('Valor fora das opcoes do select', 'aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Valor fora das opcoes do select', format('recusado (%s) | PASS', sqlstate));
  end;

  insert into public.contacts (workspace_id, name, email, custom_fields)
  values (v_ws, 'Maria', 'maria@exemplo.com.br', '{"cpf":"123.456.789-00","origem":"Indicacao"}'::jsonb)
  returning id into v_c;
  insert into r(nome,resultado) values ('Contato valido aceito',
    case when v_c is not null then 'PASS' else 'FAIL' end);

  -- ============ Auditoria sem copiar dado sensivel ============
  select after_state ? 'custom_fields', after_state->>'custom_fields_keys'
    into v_tem, v_txt
  from public.audit_log_entries where resource_id = v_c and action = 'contacts.insert';
  insert into r(nome,resultado) values ('Trilha grava chaves, nao valores',
    format('chaves=%s copiou valores=%s | %s', v_txt, coalesce(v_tem,false),
      case when v_txt like '%cpf%' and coalesce(v_tem,false) = false then 'PASS' else 'FAIL' end));

  update public.contacts set name = 'Maria Silva' where id = v_c;
  select before_state->>'name' into v_txt from public.audit_log_entries
  where resource_id = v_c and action = 'contacts.update';
  insert into r(nome,resultado) values ('Update guarda estado anterior',
    format('before.name=%s | esperado Maria | %s', v_txt, case when v_txt='Maria' then 'PASS' else 'FAIL' end));

  -- ============ N:N contato/empresa ============
  insert into public.companies (workspace_id, name) values (v_ws, 'Empresa Um') returning id into v_e;
  insert into public.companies (workspace_id, name) values (v_ws, 'Empresa Dois') returning id into v_e2;
  insert into public.contact_company_links (contact_id, company_id, role) values (v_c, v_e, 'Socia');
  insert into public.contact_company_links (contact_id, company_id, role) values (v_c, v_e2, 'Consultora');

  select count(*) into v_cnt from public.contact_company_links where contact_id = v_c;
  select count(*) into v_dur from public.contacts where id = v_c;
  insert into r(nome,resultado) values ('N:N sem duplicar cadastro',
    format('%s vinculos para %s contato | esperado 2/1 | %s', v_cnt, v_dur,
      case when v_cnt=2 and v_dur=1 then 'PASS' else 'FAIL' end));

  -- ============ Objetos customizados e relacoes ============
  insert into public.object_types (workspace_id, name, icon) values (v_ws, 'Imovel', 'home') returning id into v_ot;
  insert into public.field_definitions (workspace_id, entity_kind, object_type_id, key, label, field_type)
  values (v_ws, 'object_type', v_ot, 'metragem', 'Metragem', 'number');

  insert into public.object_records (workspace_id, object_type_id, title, custom_fields)
  values (v_ws, v_ot, 'Apto 302', '{"metragem":78}'::jsonb) returning id into v_or;

  insert into public.deals (workspace_id, title, value, contact_id)
  values (v_ws, 'Venda Apto 302', 450000, v_c) returning id into v_deal;

  insert into public.object_relations (workspace_id, from_kind, from_id, to_kind, to_id, relation_label)
  values (v_ws, 'deal', v_deal, 'object_type', v_or, 'imovel negociado');
  insert into r(nome,resultado) values ('Relacao entre negocio e objeto customizado', 'criada | PASS');

  begin
    insert into public.object_relations (workspace_id, from_kind, from_id, to_kind, to_id)
    values (v_ws, 'contact', gen_random_uuid(), 'company', v_e);
    insert into r(nome,resultado) values ('Relacao com alvo inexistente', 'aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Relacao com alvo inexistente', format('recusada (%s) | PASS', sqlstate));
  end;

  -- ============ Pipelines paralelos e historico ============
  insert into public.pipelines (workspace_id, name, entity_kind, is_default)
  values (v_ws, 'Vendas', 'deal', true) returning id into v_pipe;
  insert into public.pipelines (workspace_id, name, entity_kind)
  values (v_ws, 'Implantacao', 'deal') returning id into v_pipe2;

  insert into public.pipeline_stages (pipeline_id, name, position) values (v_pipe, 'Novo', 0) returning id into v_s1;
  insert into public.pipeline_stages (pipeline_id, name, position) values (v_pipe, 'Proposta', 1) returning id into v_s2;
  insert into public.pipeline_stages (pipeline_id, name, position, is_won, probability)
  values (v_pipe, 'Ganho', 2, true, 100) returning id into v_s3;
  insert into public.pipeline_stages (pipeline_id, name, position) values (v_pipe2, 'Aguardando', 0);

  insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id)
  values (v_pipe, v_s1, 'deal', v_deal) returning id into v_item;

  select count(*) into v_cnt from public.pipeline_stage_history where pipeline_item_id = v_item;
  insert into r(nome,resultado) values ('Entrada no pipeline registra historico',
    format('%s entrada(s) | esperado 1 | %s', v_cnt, case when v_cnt=1 then 'PASS' else 'FAIL' end));

  update public.pipeline_items set entered_stage_at = now() - interval '90 seconds' where id = v_item;
  update public.pipeline_items set stage_id = v_s2 where id = v_item;

  select duration_seconds into v_dur from public.pipeline_stage_history
  where pipeline_item_id = v_item and to_stage_id = v_s2;
  insert into r(nome,resultado) values ('Movimentacao calcula duration_seconds',
    format('%s s | esperado ~90 | %s', v_dur, case when v_dur between 85 and 95 then 'PASS' else 'FAIL' end));

  select extract(epoch from (now() - entered_stage_at))::int into v_cnt from public.pipeline_items where id = v_item;
  insert into r(nome,resultado) values ('entered_stage_at reiniciado na mudanca',
    format('%s s | esperado ~0 | %s', v_cnt, case when v_cnt < 5 then 'PASS' else 'FAIL' end));

  insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id)
  select v_pipe2, s.id, 'deal', v_deal from public.pipeline_stages s where s.pipeline_id = v_pipe2;

  select count(*) into v_cnt from public.pipeline_items where entity_id = v_deal;
  insert into r(nome,resultado) values ('Mesma entidade em pipelines paralelos',
    format('%s itens | esperado 2 | %s', v_cnt, case when v_cnt=2 then 'PASS' else 'FAIL' end));

  begin
    insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id)
    values (v_pipe, v_s1, 'deal', v_deal);
    insert into r(nome,resultado) values ('Item duplicado no mesmo pipeline', 'aceitou | FAIL');
  exception when unique_violation then
    insert into r(nome,resultado) values ('Item duplicado no mesmo pipeline', 'recusado | PASS');
  end;

  begin
    insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id)
    values (v_pipe, v_s1, 'contact', v_c);
    insert into r(nome,resultado) values ('Item de tipo incompativel com o pipeline', 'aceitou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('Item de tipo incompativel com o pipeline',
      format('recusado (%s) | PASS', sqlstate));
  end;

  -- Ordenacao dos cards dentro da coluna
  insert into public.deals (workspace_id, title) values (v_ws, 'Segundo negocio') returning id into v_deal;
  insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id, position_in_stage)
  values (v_pipe, v_s2, 'deal', v_deal, 0);
  update public.pipeline_items set position_in_stage = 1 where id = v_item;

  select string_agg(position_in_stage::text, ',' order by position_in_stage) into v_txt
  from public.pipeline_items where stage_id = v_s2;
  insert into r(nome,resultado) values ('Cards ordenados por position_in_stage',
    format('posicoes=%s | esperado 0,1 | %s', v_txt, case when v_txt='0,1' then 'PASS' else 'FAIL' end));

  begin
    update public.pipeline_stage_history set duration_seconds = 0 where pipeline_item_id = v_item;
    insert into r(nome,resultado) values ('Usuario tenta editar historico de estagio', 'alterou | FAIL');
  exception when insufficient_privilege then
    insert into r(nome,resultado) values ('Usuario tenta editar historico de estagio', 'bloqueado | PASS');
  end;

  -- ============ Isolamento: o que A enxerga ============
  select count(*) into v_cnt from public.contacts;
  insert into r(nome,resultado) values ('A enxerga apenas os proprios contatos',
    format('%s | esperado 1 | %s', v_cnt, case when v_cnt=1 then 'PASS' else 'FAIL' end));
end $$;

reset role;

-- ============ Isolamento: o que B NAO enxerga ============
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_c int; v_d int; v_p int; v_f int; v_h int;
begin
  select count(*) into v_c from public.contacts;
  select count(*) into v_d from public.deals;
  select count(*) into v_p from public.pipeline_items;
  select count(*) into v_f from public.field_definitions;
  select count(*) into v_h from public.pipeline_stage_history;
  insert into r(nome,resultado) values ('B nao le dados de A',
    format('contatos=%s negocios=%s itens=%s campos=%s historico=%s | esperado 0 | %s',
      v_c, v_d, v_p, v_f, v_h,
      case when v_c+v_d+v_p+v_f+v_h = 0 then 'PASS' else 'FAIL' end));
end $$;

reset role;

-- Escrita cross-tenant. Precisa mirar uma tabela SEM campo obrigatorio: em
-- contacts o gatilho de validacao dispara antes da politica e o teste
-- passaria pelo motivo errado, sem nunca exercitar a RLS.
do $$
declare v_ws_a uuid; v_pipe uuid; v_stage uuid; v_deal uuid; v_n int;
begin
  select id into v_ws_a from public.workspaces where slug = 'e3-ws-a';
  select p.id into v_pipe from public.pipelines p where p.workspace_id = v_ws_a and p.name = 'Vendas';
  select s.id into v_stage from public.pipeline_stages s where s.pipeline_id = v_pipe order by s.position limit 1;
  select d.id into v_deal from public.deals d where d.workspace_id = v_ws_a limit 1;

  perform set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
  set local role authenticated;

  begin
    execute format('insert into public.companies (workspace_id, name) values (%L, %L)', v_ws_a, 'Invasao');
    insert into r(nome,resultado) values ('B insere empresa no workspace de A', 'gravou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('B insere empresa no workspace de A',
      format('bloqueado (%s) | %s', sqlstate,
        case when sqlstate = '42501' then 'PASS' else 'FAIL - bloqueio pelo motivo errado' end));
  end;

  -- Tabelas filhas: o isolamento vem do pai (ADR-0013). Sem este par de
  -- verificacoes, um erro na politica derivada passaria despercebido.
  begin
    execute format('insert into public.pipeline_stages (pipeline_id, name, position) values (%L, %L, 9)', v_pipe, 'Etapa invasora');
    insert into r(nome,resultado) values ('B insere estagio em pipeline de A', 'gravou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('B insere estagio em pipeline de A',
      format('bloqueado (%s) | %s', sqlstate, case when sqlstate = '42501' then 'PASS' else 'FAIL' end));
  end;

  begin
    execute format('insert into public.pipeline_items (pipeline_id, stage_id, entity_kind, entity_id) values (%L, %L, %L, %L)',
      v_pipe, v_stage, 'deal', v_deal);
    insert into r(nome,resultado) values ('B insere card em pipeline de A', 'gravou | FAIL');
  exception when others then
    insert into r(nome,resultado) values ('B insere card em pipeline de A',
      format('bloqueado (%s) | %s', sqlstate, case when sqlstate = '42501' then 'PASS' else 'FAIL' end));
  end;

  execute format('update public.deals set title = %L where id = %L', 'Sequestrado', v_deal);
  get diagnostics v_n = row_count;
  insert into r(nome,resultado) values ('B altera negocio de A',
    format('%s linha(s) | esperado 0 | %s', v_n, case when v_n = 0 then 'PASS' else 'FAIL' end));

  reset role;
end $$;

insert into r(nome,resultado) values ('Controle negativo do harness',
  case when 1 = 0 then 'PASS' else 'FAIL detectado corretamente (harness funcional)' end);

select nome, resultado from r order by id;

rollback;
