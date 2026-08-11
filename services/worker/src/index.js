/**
 * Kommo++ VirtruvIA — servico persistente (Railway; Render como alternativa).
 *
 * Etapa 1: esqueleto com health check. Este processo existe agora para fixar
 * o contrato de deploy e ambiente. Nas etapas seguintes ele recebe WebSocket,
 * recebimento de webhooks, filas com retry/backoff e jobs agendados — nada
 * disso e implementado aqui.
 *
 * Sem dependencias externas de proposito: o servico precisa subir em segundos
 * e sobreviver a qualquer politica de rede restritiva.
 */
import http from 'node:http';

const PORT = Number(process.env.PORT) || 8080;
const STARTED_AT = new Date();

const routes = {
  '/health': () => ({
    status: 'ok',
    service: 'kommopp-worker',
    stage: 'etapa-1',
    uptime_seconds: Math.floor((Date.now() - STARTED_AT.getTime()) / 1000),
    started_at: STARTED_AT.toISOString(),
  }),
  '/ready': () => ({
    status: 'ready',
    // Etapa 1 nao possui dependencias externas para verificar.
    // Filas, WebSocket e conexao com o banco entram nas etapas seguintes.
    checks: { queue: 'not_implemented', websocket: 'not_implemented' },
  }),
};

const server = http.createServer((req, res) => {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const handler = routes[path];

  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (!handler) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not_found' }));
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(handler()));
});

server.listen(PORT, () => {
  console.log(JSON.stringify({
    level: 'info',
    msg: 'worker online',
    port: PORT,
    started_at: STARTED_AT.toISOString(),
  }));
});

// Encerramento limpo: a plataforma envia SIGTERM antes de trocar a instancia.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', msg: 'encerrando', signal }));
    server.close(() => process.exit(0));
  });
}
