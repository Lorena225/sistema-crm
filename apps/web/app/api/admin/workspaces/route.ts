import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getResellerAdmin } from '@/lib/auth/reseller';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/workspaces — leitura cross-workspace da VirtruvIA.
 *
 * Rota exclusivamente server-side. Duas barreiras:
 *  1. so responde a um usuario presente em public.reseller_admins;
 *  2. a service role nunca chega ao browser — apenas o resultado ja filtrado.
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

  // TODO(Etapa 2): registrar este acesso em audit_log_entries
  // (actor_type = 'reseller_admin', action = 'admin.workspaces.list').
  return NextResponse.json({ scope: resellerAdmin.scope, workspaces: data });
}
