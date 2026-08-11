import 'server-only';

import { createClient as createServiceClient } from '@supabase/supabase-js';

/**
 * Cliente com service role. BYPASSA RLS.
 *
 * Regras de uso (Etapa 1):
 *  - Somente em Route Handlers / Server Actions. Nunca em componente client.
 *  - Somente depois de confirmar, via `assertResellerAdmin`, que o chamador
 *    consta em public.reseller_admins.
 *  - A instrumentacao de auditoria destas rotas entra na Etapa 2
 *    (audit_log_entries), conforme escopo do programa.
 *
 * O import de 'server-only' faz o build quebrar se este modulo vazar para
 * um bundle de client.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente no ambiente do servidor.');
  }

  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
