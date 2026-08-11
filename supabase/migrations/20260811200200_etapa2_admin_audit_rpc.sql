-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 2: RPC de auditoria para rotas server-side
--
-- app.record_audit vive no schema `app`, que nao e exposto via PostgREST —
-- de proposito. Mas as rotas administrativas do Next.js falam com o banco
-- justamente por PostgREST, entao precisam de um ponto de entrada em
-- `public`. Este wrapper e esse ponto, e so ele:
--   - concedido exclusivamente a service_role (rota server-side);
--   - nao aceita escolher o ator livremente sem informar quem e;
--   - delega a escrita para app.record_audit, mantendo um unico caminho
--     de gravacao na trilha.
-- =====================================================================

create or replace function public.log_admin_action(
  p_workspace_id uuid,
  p_action        text,
  p_resource_type text,
  p_actor_id      uuid,
  p_resource_id   uuid  default null,
  p_before_state  jsonb default null,
  p_after_state   jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null then
    raise exception 'actor_id obrigatorio em operacao administrativa'
      using errcode = '22004';
  end if;

  return app.record_audit(
    p_workspace_id,
    p_action,
    p_resource_type,
    p_resource_id,
    p_before_state,
    p_after_state,
    'reseller_admin'::public.audit_actor_type,
    p_actor_id
  );
end;
$$;

comment on function public.log_admin_action is 'Ponto de entrada de auditoria para rotas administrativas server-side. Grava sempre como reseller_admin e exige o actor_id explicito. Concedido apenas a service_role.';

revoke all on function public.log_admin_action(uuid, text, text, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.log_admin_action(uuid, text, text, uuid, uuid, jsonb, jsonb) to service_role;
