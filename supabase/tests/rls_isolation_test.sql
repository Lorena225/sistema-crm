-- =====================================================================
-- Teste reproduzivel de isolamento cross-tenant (Etapa 1)
--
-- Executar com:
--   supabase db execute --file supabase/tests/rls_isolation_test.sql
-- ou colar no SQL Editor do Supabase.
--
-- O script roda inteiro dentro de uma transacao encerrada em ROLLBACK:
-- nao deixa residuo no banco. Cada verificacao imprime PASS/FAIL.
-- =====================================================================

begin;

-- Usuarios efemeros de teste
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000000','aaaaaaaa-0000-4000-8000-000000000001','authenticated','authenticated','rls-a@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}'),
  ('00000000-0000-0000-0000-000000000000','bbbbbbbb-0000-4000-8000-000000000002','authenticated','authenticated','rls-b@test.local','x', now(), now(), now(), '{"provider":"email"}', '{}');

create temp table rls_report(id serial, check_name text, result text) on commit drop;
grant all on table rls_report to authenticated;
grant all on sequence rls_report_id_seq to authenticated;

-- Usuario A cria o Workspace A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('Workspace A', 'ws-a-test');
reset role;

-- Usuario B cria o Workspace B
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.create_workspace('Workspace B', 'ws-b-test');
reset role;

-- Assercoes sob a identidade de A
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_count int; v_slugs text; v_updated int; v_deleted int;
begin
  select count(*), coalesce(string_agg(slug, ','), '-') into v_count, v_slugs from public.workspaces;
  insert into rls_report(check_name, result) values ('A le workspaces',
    format('%s linha(s) [%s] | esperado 1 [ws-a-test] | %s', v_count, v_slugs,
      case when v_count = 1 and v_slugs = 'ws-a-test' then 'PASS' else 'FAIL' end));

  select count(*) into v_count from public.workspace_members;
  insert into rls_report(check_name, result) values ('A le workspace_members',
    format('%s linha(s) | esperado 1 | %s', v_count, case when v_count = 1 then 'PASS' else 'FAIL' end));

  update public.workspaces set name = 'INVASAO' where slug = 'ws-b-test';
  get diagnostics v_updated = row_count;
  insert into rls_report(check_name, result) values ('A tenta UPDATE no workspace B',
    format('%s linha(s) afetada(s) | esperado 0 | %s', v_updated, case when v_updated = 0 then 'PASS' else 'FAIL' end));

  delete from public.workspace_members;
  get diagnostics v_deleted = row_count;
  insert into rls_report(check_name, result) values ('A tenta DELETE amplo em workspace_members',
    format('%s linha(s) afetada(s) | esperado no maximo 1 (a propria, do ws A) | %s', v_deleted,
      case when v_deleted <= 1 then 'PASS' else 'FAIL' end));

  begin
    insert into public.workspaces (name, slug) values ('Direto', 'ws-direto');
    insert into rls_report(check_name, result) values ('A tenta INSERT direto em workspaces', 'permitido | esperado bloqueado | FAIL');
  exception when insufficient_privilege then
    insert into rls_report(check_name, result) values ('A tenta INSERT direto em workspaces', 'bloqueado (insufficient_privilege) | PASS');
  end;

  begin
    perform 1 from public.reseller_admins;
    insert into rls_report(check_name, result) values ('A tenta SELECT em reseller_admins', 'permitido | esperado bloqueado | FAIL');
  exception when insufficient_privilege then
    insert into rls_report(check_name, result) values ('A tenta SELECT em reseller_admins', 'bloqueado (insufficient_privilege) | PASS');
  end;

  -- Controle negativo: prova que o harness detecta divergencia
  insert into rls_report(check_name, result) values ('Controle negativo do harness',
    case when 1 = 0 then 'PASS' else 'FAIL detectado corretamente (harness funcional)' end);
end $$;

reset role;

select check_name, result from rls_report order by id;

rollback;
