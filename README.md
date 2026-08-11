# Kommo++ VirtruvIA — `sistema-crm`

CRM multi-tenant, messenger-first, da VirtruvIA. Monorepo unico: este
repositorio e a **fonte de verdade** de schema, decisoes e codigo entre as
frentes de construcao. Historico de chat nao vale como referencia.

**Etapa atual: 1 — Fundacao de repositorio, infraestrutura e multi-tenancy.**

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
```

## Banco

```bash
supabase link --project-ref <ref>
supabase db push                       # aplica migrations
```

Teste de isolamento cross-tenant: `supabase/tests/rls_isolation_test.sql`
(roda em transacao com ROLLBACK; nao deixa residuo).

## Documentacao

- Schema vigente: [`docs/schema/README.md`](docs/schema/README.md)
- Decisoes tecnicas: [`docs/architecture/README.md`](docs/architecture/README.md)
- Escopo do produto: [`docs/product-spec/`](docs/product-spec/)

## Proxima etapa

Etapa 2 — Seguranca, auditoria e billing esqueleto (`audit_log_entries`,
abstracoes de fila/webhook/idempotencia/criptografia, PWA offline, schema de
billing). Nao antecipar nada disso aqui.
