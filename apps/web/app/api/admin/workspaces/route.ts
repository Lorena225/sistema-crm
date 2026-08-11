import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResellerAdmin } from '@/lib/auth/reseller';

export const dynamic = 'force-dynamic';

// Workspace nulo: a listagem cross-workspace nao pertence a um tenant.
const SEM_WORKSPACE = '00000000-0000-0000-0000-000000000000';

/**
 * GET /api/admin/workspaces — leitura cross-workspace da VirtruvIA.
 *
 * Rota exclusivamente server-side, com tres barreiras:
 *  1. so responde a um usuario presente em public.reseller_admins;
 *  2. a service role nunca chega ao browser — apenas o resultado ja filtrado;
 *  3. toda chamada autorizada e gravada em audit_log_entries antes de a
 *     resposta sair (Etapa 2). Acesso administrativo sem trilha nao existe.
 *
 * Quem nao e reseller_admin recebe 404, e nao 403: a existencia da rota
 * administrativa nao e confirmada para terceiros.
 */
export async function GET() {
  const resellerAdmin = await getResellerAdmin();

  if (!resellerAdmin) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workspaces')
    .select('id, name, slug, plan, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  // Auditoria da operacao administrativa. Se a trilha falhar, a resposta nao
  // sai: o acesso e permitido porque fica registrado, entao registrar nao e
  // um efeito colateral opcional.
  const { error: erroAuditoria } = await admin.rpc('log_admin_action', {
    p_workspace_id: SEM_WORKSPACE,
    p_action: 'admin.workspaces.list',
    p_resource_type: 'workspace',
    p_actor_id: resellerAdmin.user_id,
    p_after_state: { scope: resellerAdmin.scope, total: data?.length ?? 0 },
  });

  if (erroAuditoria) {
    return NextResponse.json({ error: 'audit_failed' }, { status: 500 });
  }

  return NextResponse.json({ scope: resellerAdmin.scope, workspaces: data });
}
