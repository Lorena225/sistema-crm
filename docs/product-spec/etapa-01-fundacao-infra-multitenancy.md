# Etapa 1 — Fundacao de repositorio, infraestrutura e multi-tenancy

**Responsavel:** Claude.
**Dependencia:** inicio do programa; nao existe schema de tenant confiavel antes desta etapa.
**Status:** entregue em 11/08/2026 (deploys de Vercel e Railway pendentes de acao na conta — ver `docs/architecture/provisionamento.md`).

## Objetivo

Montar a base compartilhada do Kommo++: repositorio, infraestrutura,
autenticacao e isolamento inicial de workspace, de forma que as etapas
posteriores construam dados multi-tenant sobre uma fundacao versionada e
segura.

## Escopo entregue

1. Monorepo com `/docs`, `/supabase/migrations`, `/apps/web`, `/services/worker`
   e ADRs de infraestrutura.
2. Supabase Postgres provisionado, com `pgvector` e Storage; Next.js pronto
   para deploy; worker persistente com health check.
3. Migrations de `workspaces`, `workspace_members` e `reseller_admins`, com
   RLS e indices.
4. Vinculo `auth.uid()` -> `workspace_members` via Supabase Auth.
5. Isolamento cross-tenant provado por teste reproduzivel.

## Fora de escopo (Etapa 2 em diante)

- `audit_log_entries`, abstracoes de fila/webhook/idempotencia/criptografia,
  PWA offline e schema de billing — **Etapa 2**.
- Entidades de CRM, campos customizados, tarefas, pipelines, canais,
  automacoes, IA, BI, casos e integracoes — etapas seguintes.
- Valores de plano, franquias, gateways e metodos de cobranca. `workspaces.plan`
  nao autoriza hardcode comercial.
- Acesso cross-workspace no navegador ou service role no client-side.

## Criterios de aceite

| # | Criterio | Situacao |
|---|---|---|
| 1 | Estrutura `/docs`, `/supabase/migrations`, `/apps/web`, `/services/worker` com documentacao inicial e ADRs | Atendido |
| 2 | Supabase Postgres, pgvector, Storage provisionados | Atendido |
| 3 | Vercel e servico Railway/Render provisionados; worker responde health check | Worker verificado local; deploys dependem do push e de acao na conta |
| 4 | Migrations criam as tres tabelas com as colunas literais, RLS e indices | Atendido |
| 5 | Usuario autenticado pode pertencer a um workspace via `workspace_members` | Atendido |
| 6 | Teste reproduzivel prova que membro do workspace A nao le nem altera o B | Atendido — `supabase/tests/rls_isolation_test.sql` |
| 7 | Nenhum segredo em codigo/commit; nenhum acesso de `reseller_admins` no client-side | Atendido |

## Proxima etapa

Etapa 2 — Seguranca, auditoria e billing esqueleto.
