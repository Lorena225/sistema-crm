-- =====================================================================
-- Kommo++ VirtruvIA — Etapa 1: RPC de bootstrap de workspace
-- Motivo: public.workspaces nao possui politica de INSERT. O criador
-- ainda nao e membro no instante do INSERT, entao a criacao do
-- workspace e do vinculo owner precisa ser atomica e controlada.
-- =====================================================================

create or replace function public.create_workspace(p_name text, p_slug text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace public.workspaces;
begin
  if v_uid is null then
    raise exception 'auth_required' using errcode = '42501';
  end if;

  insert into public.workspaces (name, slug)
  values (btrim(p_name), lower(btrim(p_slug)))
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (v_workspace.id, v_uid, 'owner', 'active');

  return v_workspace;
end;
$$;

comment on function public.create_workspace(text, text) is 'Cria um workspace e vincula o chamador como owner ativo, de forma atomica. Unico caminho de INSERT em public.workspaces para usuarios autenticados.';

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
