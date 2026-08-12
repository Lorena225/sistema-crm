/**
 * Kommo++ VirtruvIA — servico persistente (Railway; Render como alternativa).
 *
 * Etapa 2: fila com retry/backoff, receptor generico de webhook,
 * idempotencia, criptografia de credenciais e observabilidade.
 *
 * Nenhum provedor real esta integrado. A fonte `simulado` existe para provar
 * o comportamento exigido pela etapa: um webhook que falha de proposito e
 * reprocessado sem duplicar o efeito externo.
 *
 * Sem dependencias npm: o servico sobe em segundos e sobrevive a qualquer
 * politica de rede restritiva.
 */
import http from 'node:http';

import { logger } from './lib/logger.js';
import { exportar as exportarMetricas, instantaneo, incrementar } from './lib/metrics.js';
import { criarFila } from './lib/queue.js';
import { criarIdempotencia } from './lib/idempotency.js';
import { criarReceptorWebhook } from './lib/webhooks.js';
import { registrarFontesSimuladas, efeitoExterno } from './simulacao/webhook-simulado.js';
import { normalizar } from './canais/normalizador.js';
import { criarControleDeTaxa } from './canais/twilio.js';
import { registrarFilaDeSaida } from './canais/fila-saida.js';
import { criarTransporteTwilio, criarResolvedorDeCredenciais } from './canais/transporte-twilio.js';
import { criarRepositorioSupabase } from './canais/repositorio-supabase.js';

const PORT = Number(process.env.PORT) || 8080;
const INICIADO_EM = new Date();

// --- Primitivas transversais ------------------------------------------
export const fila = criarFila({ tentativasMaximas: 5, atrasoBaseMs: 100 });
export const idempotencia = criarIdempotencia();
export const receptor = criarReceptorWebhook({ fila, idempotencia });

registrarFontesSimuladas({ fila, idempotencia, receptor });

// --- Canais reais -----------------------------------------------------
// O worker so monta o caminho real quando as credenciais existem. Sem elas,
// segue de pe com health check e a fonte simulada: uma variavel ausente nao
// pode derrubar o servico inteiro.
export const controleDeTaxa = criarControleDeTaxa();
export let repositorio = null;
export let saida = null;

function canaisConfigurados() {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

if (canaisConfigurados()) {
  repositorio = criarRepositorioSupabase();
  const credenciaisDaConta = criarResolvedorDeCredenciais({ repositorio });

  saida = registrarFilaDeSaida({
    fila,
    controleDeTaxa,
    repositorio,
    transportes: {
      whatsapp: criarTransporteTwilio({ credenciaisDaConta, canal: 'whatsapp' }),
      sms: criarTransporteTwilio({ credenciaisDaConta, canal: 'sms' }),
    },
  });

  // Webhook do Twilio: WhatsApp e SMS chegam pelo mesmo envelope.
  receptor.registrarFonte('twilio', {
    segredo: process.env.TWILIO_WEBHOOK_SECRET,
    chaveDeduplicacao: (payload) => payload.MessageSid ?? payload.SmsSid,
    tipoJob: 'canal.receber',
  });

  fila.registrar('canal.receber', async ({ payload }, { log }) => {
    // Se o Twilio manda callback de status, e atualizacao de entrega, nao
    // mensagem nova.
    if (payload.MessageStatus && !payload.Body && Number(payload.NumMedia ?? 0) === 0) {
      const status = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed', undelivered: 'failed' };
      await repositorio.atualizarEntregaPorIdExterno(payload.MessageSid, {
        delivery_status: status[payload.MessageStatus] ?? 'sent',
        error_reason: payload.ErrorCode ? `Twilio codigo ${payload.ErrorCode}` : null,
      });
      return { tipo: 'status' };
    }

    const normalizada = normalizar('twilio', payload);
    if (!normalizada) return { ignorada: true };

    const conta = await repositorio.obterContaPorNumero(payload.To, normalizada.canal);
    if (!conta) {
      log.warn('evento sem conta de canal correspondente', { para: payload.To });
      return { ignorada: true };
    }

    const conversa = await repositorio.encontrarOuCriarConversa({
      conta,
      remetente: normalizada.remetente_externo,
      nome: payload.ProfileName,
    });

    const mensagem = await repositorio.registrarMensagemRecebida(conversa.id, normalizada);
    log.info('mensagem recebida registrada', { conversa_id: conversa.id, nova: Boolean(mensagem) });
    return { conversa_id: conversa.id };
  });
}

// Limpeza periodica das chaves de deduplicacao vencidas.
const limpeza = setInterval(async () => {
  const removidos = await idempotencia.adaptador.limparExpirados();
  if (removidos > 0) logger.debug('chaves de idempotencia expiradas removidas', { removidos });
}, 60 * 60 * 1000);
limpeza.unref?.();

// --- HTTP --------------------------------------------------------------
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '';
    req.on('data', (pedaco) => {
      dados += pedaco;
      if (dados.length > 1_000_000) {
        reject(new Error('payload_grande_demais'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(dados));
    req.on('error', reject);
  });
}

function responder(res, status, corpo, tipo = 'application/json; charset=utf-8') {
  res.statusCode = status;
  res.setHeader('Content-Type', tipo);
  res.end(typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const caminho = url.pathname;
  const inicio = Date.now();

  try {
    if (caminho === '/health') {
      return responder(res, 200, {
        status: 'ok',
        service: 'kommopp-worker',
        stage: 'etapa-2',
        uptime_seconds: Math.floor((Date.now() - INICIADO_EM.getTime()) / 1000),
        started_at: INICIADO_EM.toISOString(),
      });
    }

    if (caminho === '/ready') {
      return responder(res, 200, {
        status: 'ready',
        fila: fila.estado,
        fontes_webhook: receptor.fontes,
        canais_reais: canaisConfigurados() ? 'configurados' : 'ausentes (SUPABASE_SERVICE_ROLE_KEY)',
      });
    }

    if (caminho === '/metrics') {
      return responder(res, 200, exportarMetricas(), 'text/plain; version=0.0.4');
    }

    if (caminho === '/metrics.json') {
      return responder(res, 200, instantaneo());
    }

    // POST /webhooks/:fonte
    if (caminho.startsWith('/webhooks/') && req.method === 'POST') {
      const fonte = caminho.slice('/webhooks/'.length);
      const corpoBruto = await lerCorpo(req);
      const resultado = await receptor.receber({
        fonte,
        corpoBruto,
        assinatura: req.headers['x-signature'],
        cabecalhos: req.headers,
      });
      return responder(res, resultado.status, resultado.corpo);
    }

    // Enfileira uma mensagem de saida. Chamado pelo Next.js apos gravar a
    // mensagem como `queued`; o worker cuida de janela, teto, envio e status.
    if (caminho === '/saida' && req.method === 'POST') {
      if (!saida) return responder(res, 503, { erro: 'canais_nao_configurados' });
      const corpo = JSON.parse(await lerCorpo(req));
      const ultima = corpo.conversaId
        ? await repositorio.ultimaMensagemDoContato(corpo.conversaId)
        : null;
      saida.enfileirar({ ...corpo, ultimaMensagemDoContatoEm: ultima });
      fila.bombear();
      return responder(res, 202, { status: 'enfileirada' });
    }

    // Leitura do efeito externo simulado — usada pelo teste de idempotencia.
    if (caminho === '/simulacao/efeito') {
      return responder(res, 200, efeitoExterno.instantaneo());
    }

    return responder(res, 404, { erro: 'not_found' });
  } catch (erro) {
    logger.error('falha ao tratar requisicao', { caminho, erro: erro.message });
    incrementar('worker_http_erros_total', { caminho });
    return responder(res, 500, { erro: 'erro_interno' });
  } finally {
    incrementar('worker_http_requisicoes_total', { caminho, status: res.statusCode });
    logger.debug('requisicao tratada', {
      caminho,
      metodo: req.method,
      status: res.statusCode,
      duracao_ms: Date.now() - inicio,
    });
  }
});

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    logger.info('worker online', { port: PORT, started_at: INICIADO_EM.toISOString() });
  });
}

for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    logger.info('encerrando', { sinal });
    fila.encerrar();
    clearInterval(limpeza);
    server.close(() => process.exit(0));
  });
}

export { server };
