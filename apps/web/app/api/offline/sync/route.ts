import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const TIPOS_ACEITOS = ['nota.criar', 'tarefa.criar', 'checkin.registrar'] as const;
type TipoAceito = (typeof TIPOS_ACEITOS)[number];

/**
 * POST /api/offline/sync — reconciliacao de uma operacao registrada offline.
 *
 * O ponto central desta rota e a REVALIDACAO. Uma operacao pode ter sido
 * registrada horas antes, no aparelho, sem rede. Entre aquele momento e este,
 * a pessoa pode ter sido removida do workspace ou desativada. A fila local
 * guarda uma intencao, nao uma permissao.
 *
 * A checagem usa o cliente sob RLS, nao service role: a consulta a
 * workspace_members so devolve linha se a politica
 * workspace_members_select_member autorizar. Ou seja, a propria RLS e o
 * mecanismo de autorizacao — nao ha caminho paralelo que a contorne.
 *
 * Nesta etapa a operacao e ACEITA e NAO PERSISTIDA: as tabelas tasks e notes
 * pertencem as Etapas 4 e 5. Criar aqui uma tabela improvisada para "guardar
 * enquanto isso" seria justamente o tipo de schema inventado que a disciplina
 * do programa proibe.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ erro: 'nao_autenticado' }, { status: 401 });
  }

  let corpo: { id?: string; tipo?: string; workspaceId?: string; criadaEm?: string };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ erro: 'payload_invalido' }, { status: 400 });
  }

  const { id, tipo, workspaceId, criadaEm } = corpo;

  if (!id || !tipo || !workspaceId) {
    return NextResponse.json({ erro: 'campos_obrigatorios_ausentes' }, { status: 400 });
  }

  if (!TIPOS_ACEITOS.includes(tipo as TipoAceito)) {
    return NextResponse.json({ erro: 'tipo_nao_suportado' }, { status: 400 });
  }

  // Revalidacao de autorizacao, sob RLS.
  const { data: vinculo, error } = await supabase
    .from('workspace_members')
    .select('id, role, status')
    .eq('workspace_id', workspaceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ erro: 'falha_na_verificacao' }, { status: 500 });
  }

  if (!vinculo || vinculo.status !== 'active') {
    return NextResponse.json({ erro: 'sem_autorizacao_no_workspace' }, { status: 403 });
  }

  return NextResponse.json({
    status: 'aceita',
    id,
    tipo,
    registrada_em: criadaEm ?? null,
    reconciliada_em: new Date().toISOString(),
    // Sinaliza ao cliente que a operacao foi autorizada mas ainda nao tem
    // destino final. A persistencia entra com tasks (Etapa 4) e notes (Etapa 5).
    persistida: false,
  });
}
