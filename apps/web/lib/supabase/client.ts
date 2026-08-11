'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente Supabase para o browser.
 * Usa exclusivamente a anon key: toda leitura/escrita passa por RLS.
 * A service role key NUNCA pode ser importada aqui.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
