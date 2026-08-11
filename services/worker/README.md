# @kommopp/worker

Servico persistente do Kommo++. Na Etapa 1 entrega apenas health check;
WebSocket, webhooks, filas com retry e jobs agendados chegam nas etapas
seguintes.

## Rodar local

```bash
npm run dev --workspace @kommopp/worker
curl http://localhost:8080/health
```

## Deploy (Railway)

1. New Project > Deploy from GitHub repo > `Lorena225/sistema-crm`.
2. Root Directory: `services/worker`.
3. Start Command: `node src/index.js` (ja definido em `railway.json`).
4. Healthcheck Path: `/health`.
5. Variaveis: apenas `PORT` (a Railway injeta automaticamente) e `NODE_ENV`.

Render e alternativa compativel: Web Service, Node 20, mesmo start command e
health check path.
