import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export type ResellerAdmin = {
  id: string;
  user_id: string;
  scope: 'all_workspaces';
};

/**
 * Caminho administrativo da VirtruvIA (Etapa 1: preparado, sem telas).
 *
 * Retorna o registro de reseller_admin do usuario da sessao, ou null.
 * A leitura de public.reseller_admins so e possivel com service role: a
 * tabela tem RLS habilitada e NENHUMA politica, e nao ha grant para anon
 * nem para authenticated. Isso torna o acesso impossivel pelo browser
 * mesmo que alguem chame a API REST diretamente com a anon key.
 *
 * A instrumentacao de auditoria destas rotas (audit_log_entries) entra na
 * Etapa 2, conforme escopo do programa.
 */
export async function getResellerAdmin(): Promise<ResellerAdmin | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('reseller_admins')
    .select('id, user_id, scope')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return null;
  return data as ResellerAdmin;
}
