-- =====================================================================
-- Teste reproduzivel da Etapa 2: auditoria append-only, isolamento da
-- trilha e da medicao de consumo.
--
-- Executar com:
--   supabase db execute --file supabase/tests/etapa2_audit_billing_test.sql
-- ou colar no SQL Editor do Supabase.
--
-- Roda inteiro em uma transacao encerrada em ROLLBACK: nao deixa residuo.
-- =====================================================================

begin;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated','e2-a@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000002','authenticated','authenticated','e2-b@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}');

create temp table e2_report(id serial, check_name text, result text) on commit drop;
grant all on table e2_report to authenticated;
grant all on sequence e2_report_id_seq to authenticated;

-- A cria o workspace A; B cria o workspace B.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('Workspace A', 'e2-ws-a');
reset role;

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('Workspace B', 'e2-ws-b');
reset role;

-- Medicao de consumo escrita pelo sistema (postgres = papel de servico).
insert into public.usage_meter_entries (workspace_id, metric, quantity, provider_cost, provider_currency, client_rate)
select id, 'audio_transcription_minutes', 12.5, 0.75, 'USD', 4.20 from public.workspaces where slug = 'e2-ws-a';
insert into public.usage_meter_entries (workspace_id, metric, quantity)
select id, 'audio_transcription_minutes', 3 from public.workspaces where slug = 'e2-ws-b';

-- ============ Assercoes sob a identidade de A ============
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  v_count int; v_actions text; v_actor text; v_after jsonb; v_affected int;
begin
  -- 1. A criacao do workspace gerou trilha automatica (workspace + owner).
  select count(*), string_agg(action, ',' order by created_at)
    into v_count, v_actions
  from public.audit_log_entries;
  insert into e2_report(check_name, result) values ('Trilha gerada na criacao do workspace',
    format('%s entrada(s) [%s] | esperado 2 [workspace.created,workspace_member.created] | %s',
      v_count, v_actions,
      case when v_count = 2 and v_actions = 'workspace.created,workspace_member.created' then 'PASS' else 'FAIL' end));

  -- 2. Ator e estado foram gravados.
  select actor_type::text, after_state into v_actor, v_after
  from public.audit_log_entries where action = 'workspace.created';
  insert into e2_report(check_name, result) values ('Ator e after_state registrados',
    format('actor=%s slug=%s | esperado user / e2-ws-a | %s', v_actor, v_after->>'slug',
      case when v_actor = 'user' and v_after->>'slug' = 'e2-ws-a' then 'PASS' else 'FAIL' end));

  -- 3. A trilha do workspace B e invisivel para A.
  select count(*) into v_count from public.audit_log_entries
  where after_state->>'slug' = 'e2-ws-b';
  insert into e2_report(check_name, result) values ('Trilha cross-tenant invisivel',
    format('%s entrada(s) do ws B | esperado 0 | %s', v_count, case when v_count = 0 then 'PASS' else 'FAIL' end));

  -- 4. UPDATE na trilha e recusado.
  begin
    update public.audit_log_entries set action = 'adulterado';
    get diagnostics v_affected = row_count;
    insert into e2_report(check_name, result) values ('UPDATE na trilha',
      format('%s linha(s) alterada(s) | esperado bloqueado | %s', v_affected,
        case when v_affected = 0 then 'PASS (sem permissao de escrita)' else 'FAIL' end));
  exception when others then
    insert into e2_report(check_name, result) values ('UPDATE na trilha',
      format('bloqueado (%s) | PASS', sqlstate));
  end;

  -- 5. DELETE na trilha e recusado.
  begin
    delete from public.audit_log_entries;
    get diagnostics v_affected = row_count;
    insert into e2_report(check_name, result) values ('DELETE na trilha',
      format('%s linha(s) apagada(s) | esperado bloqueado | %s', v_affected,
        case when v_affected = 0 then 'PASS (sem permissao de escrita)' else 'FAIL' end));
  exception when others then
    insert into e2_report(check_name, result) values ('DELETE na trilha',
      format('bloqueado (%s) | PASS', sqlstate));
  end;

  -- 6. Usuario final nao forja entrada na propria trilha.
  begin
    perform app.record_audit(
      (select id from public.workspaces limit 1), 'forjado', 'workspace');
    insert into e2_report(check_name, result) values ('Usuario tenta escrever na trilha', 'permitido | FAIL');
  exception when insufficient_privilege then
    insert into e2_report(check_name, result) values ('Usuario tenta escrever na trilha', 'bloqueado | PASS');
  end;

  -- 7. Medicao de consumo: A ve so a propria.
  select count(*) into v_count from public.usage_meter_entries;
  insert into e2_report(check_name, result) values ('A le usage_meter_entries',
    format('%s linha(s) | esperado 1 | %s', v_count, case when v_count = 1 then 'PASS' else 'FAIL' end));

  -- 8. Cliente nao declara o proprio consumo.
  begin
    insert into public.usage_meter_entries (workspace_id, metric, quantity)
    select id, 'audio_transcription_minutes', 999 from public.workspaces limit 1;
    insert into e2_report(check_name, result) values ('A tenta inserir consumo', 'permitido | FAIL');
  exception when insufficient_privilege then
    insert into e2_report(check_name, result) values ('A tenta inserir consumo', 'bloqueado | PASS');
  end;

  insert into e2_report(check_name, result) values ('Controle negativo do harness',
    case when 1 = 0 then 'PASS' else 'FAIL detectado corretamente (harness funcional)' end);
end $$;

reset role;

-- ============ Append-only vale tambem para papel de servico ============
do $$
declare v_affected int;
begin
  begin
    update public.audit_log_entries set action = 'adulterado_por_servico';
    get diagnostics v_affected = row_count;
    insert into e2_report(check_name, result) values ('UPDATE na trilha como papel de servico',
      format('%s linha(s) | esperado bloqueado pelo gatilho | FAIL', v_affected));
  exception when insufficient_privilege then
    insert into e2_report(check_name, result) values ('UPDATE na trilha como papel de servico',
      'bloqueado pelo gatilho append-only | PASS');
  end;

  begin
    delete from public.audit_log_entries;
    insert into e2_report(check_name, result) values ('DELETE na trilha como papel de servico', 'permitido | FAIL');
  exception when insufficient_privilege then
    insert into e2_report(check_name, result) values ('DELETE na trilha como papel de servico',
      'bloqueado pelo gatilho append-only | PASS');
  end;
end $$;

-- ============ Operacao administrativa auditada ============
do $$
declare v_count int;
begin
  perform app.record_audit(
    (select id from public.workspaces where slug = 'e2-ws-a'),
    'admin.workspaces.list', 'workspace', null, null,
    jsonb_build_object('scope', 'all_workspaces'),
    'reseller_admin', 'aaaaaaaa-0000-4000-8000-000000000001'::uuid);

  select count(*) into v_count from public.audit_log_entries
  where actor_type = 'reseller_admin' and action = 'admin.workspaces.list';

  insert into e2_report(check_name, result) values ('Operacao administrativa auditada',
    format('%s entrada(s) reseller_admin | esperado 1 | %s', v_count,
      case when v_count = 1 then 'PASS' else 'FAIL' end));
end $$;

select check_name, result from e2_report order by id;

rollback;
