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

const PORT = Number(process.env.PORT) || 8080;
const INICIADO_EM = new Date();

// --- Primitivas transversais ------------------------------------------
export const fila = criarFila({ tentativasMaximas: 5, atrasoBaseMs: 100 });
export const idempotencia = criarIdempotencia();
export const receptor = criarReceptorWebhook({ fila, idempotencia });

registrarFontesSimuladas({ fila, idempotencia, receptor });

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
