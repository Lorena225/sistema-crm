import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inbox/enviar — pede ao worker que envie uma mensagem já gravada.
 *
 * A rota é uma ponte, não o remetente: quem conhece janela de 24h, teto por
 * conta, retry e backoff é o worker. Aqui só confirmamos a autorização e
 * repassamos.
 *
 * Se o worker estiver fora do ar, a mensagem continua `queued` no banco. Ela
 * não se perde — sai quando o serviço voltar.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'nao_autenticado' }, { status: 401 });

  const corpo = await request.json().catch(() => null);
  if (!corpo?.mensagemId || !corpo?.conversaId) {
    return NextResponse.json({ erro: 'campos_obrigatorios_ausentes' }, { status: 400 });
  }

  // Autorização sob RLS: se a conversa não aparece, não há acesso a ela.
  const { data: conversa } = await supabase
    .from('conversations')
    .select('id, channel_account_id')
    .eq('id', corpo.conversaId)
    .maybeSingle();

  if (!conversa) return NextResponse.json({ erro: 'conversa_nao_encontrada' }, { status: 404 });

  const worker = process.env.WORKER_PUBLIC_URL;
  if (!worker) {
    return NextResponse.json({
      erro: 'worker_nao_configurado',
      detalhe: 'A mensagem ficou na fila. Defina WORKER_PUBLIC_URL para que o envio seja processado.',
    }, { status: 503 });
  }

  try {
    const resposta = await fetch(`${worker.replace(/\/$/, '')}/saida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensagemId: corpo.mensagemId,
        conversaId: corpo.conversaId,
        canal: corpo.canal,
        channelAccountId: corpo.channelAccountId ?? conversa.channel_account_id,
        destino: corpo.destino,
        conteudo: corpo.conteudo,
        ehAutomatica: false,
      }),
    });

    if (!resposta.ok) {
      return NextResponse.json({ erro: 'worker_recusou', status: resposta.status }, { status: 502 });
    }

    return NextResponse.json({ status: 'enfileirada' });
  } catch {
    return NextResponse.json({
      erro: 'worker_indisponivel',
      detalhe: 'A mensagem permanece na fila e será enviada quando o serviço voltar.',
    }, { status: 503 });
  }
}
