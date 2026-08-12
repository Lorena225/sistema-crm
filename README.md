# Kommo++ VirtruvIA — `sistema-crm`

CRM multi-tenant, messenger-first, da VirtruvIA. Monorepo unico: este
repositorio e a **fonte de verdade** de schema, decisoes e codigo entre as
frentes de construcao. Historico de chat nao vale como referencia.

**Etapa atual: 5 — Inbox omnichannel e cockpit.**

## Estrutura

```
/docs
  /product-spec   descritivo completo v1.0, brief da Fase 0 e prompts por etapa
  /architecture   ADRs — uma decisao por arquivo
  /schema         documentacao legivel do schema vigente
/supabase
  /migrations     migrations SQL (convencao Supabase CLI)
  /tests          testes reproduziveis de RLS
/apps
  /web            Next.js (Vercel)
/services
  /worker         servico persistente (Railway; Render como alternativa)
```

## Regras inviolaveis do repositorio

1. Toda mudanca de schema e uma **migration versionada** em
   `/supabase/migrations`. Nunca editar schema pelo painel do Supabase.
2. Nenhuma tabela entra sem **RLS e politica** na mesma migration/PR.
3. Toda tabela de tenant tem `workspace_id` + indice; toda coluna usada em
   politica RLS e indexada.
4. Nenhum segredo em codigo, commit, log ou documentacao. Somente variaveis
   de ambiente / Supabase Vault.
5. `reseller_admins` opera apenas por rota server-side autenticada e auditada.
   Nunca no client-side.
6. BRL e a moeda base da plataforma.
7. A RLS **reforca**, nao substitui, a autorizacao da aplicacao.

## Rodar local

```bash
npm install
cp .env.example apps/web/.env.local   # preencher com valores reais
npm run dev:web                        # http://localhost:3000
npm run dev:worker                     # http://localhost:8080/health
npm run test:worker                    # primitivas: fila, idempotencia, cripto, log
```

Verificacao rapida do webhook simulado (falha duas vezes, aplica o efeito uma):

```bash
curl -X POST localhost:8080/webhooks/simulado -d '{"event_id":"evt_1","falhas_ate":2}'
curl -X POST localhost:8080/webhooks/simulado -d '{"event_id":"evt_1","falhas_ate":2}'
curl localhost:8080/simulacao/efeito   # total_aplicacoes deve ser 1
```

## Banco

```bash
supabase link --project-ref <ref>
supabase db push                       # aplica migrations
```

Testes reproduziveis (rodam em transacao com ROLLBACK; nao deixam residuo):

- `supabase/tests/rls_isolation_test.sql` — isolamento cross-tenant
- `supabase/tests/etapa2_audit_billing_test.sql` — trilha append-only e medicao
- `supabase/tests/etapa3_crm_test.sql` — campos, validacao, relacoes e pipelines
- `supabase/tests/etapa4_produtividade_comercial_test.sql` — tarefas, agendamento, campanhas e itens de negocio

## Documentacao

- Schema vigente: [`docs/schema/README.md`](docs/schema/README.md)
- Decisoes tecnicas: [`docs/architecture/README.md`](docs/architecture/README.md)
- Escopo do produto: [`docs/product-spec/`](docs/product-spec/)

## Proxima etapa

Etapa 5 — Inbox omnichannel e cockpit. Nao antecipar nada disso nas etapas
anteriores.
