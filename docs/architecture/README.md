# Decisoes de arquitetura (ADRs)

Uma decisao por arquivo. ADR aceito nao se reescreve: quando uma decisao muda,
cria-se um novo ADR que a substitui e marca-se o anterior como substituido.

| # | Decisao | Status | Etapa |
|---|---|---|---|
| [0001](ADR-0001-supabase-postgres-banco-e-auth.md) | Supabase Postgres como banco e autenticacao | Aceito | 1 |
| [0002](ADR-0002-nextjs-vercel-frontend.md) | Next.js na Vercel para frontend e APIs curtas | Aceito | 1 |
| [0003](ADR-0003-worker-persistente-railway.md) | Servico persistente na Railway (Render como alternativa) | Aceito | 1 |
| [0004](ADR-0004-multi-tenancy-schema-compartilhado-rls.md) | Multi-tenancy por schema compartilhado + RLS | Aceito | 1 |
| [0005](ADR-0005-acesso-reseller-admin-server-side.md) | Acesso reseller_admin server-side, deny-by-default | Aceito | 1 |
| [0006](ADR-0006-migrations-versionadas-fonte-de-verdade.md) | Migrations versionadas como unica fonte de verdade do schema | Aceito | 1 |
| [0007](ADR-0007-rpc-create-workspace.md) | Criacao de workspace via RPC SECURITY DEFINER | Aceito | 1 |
| [0008](ADR-0008-auditoria-append-only.md) | Auditoria append-only imposta pelo banco | Aceito | 2 |
| [0009](ADR-0009-auditoria-de-operacoes-administrativas.md) | Operacao administrativa so existe se ficar registrada | Aceito | 2 |
| [0010](ADR-0010-primitivas-em-memoria-com-adaptador.md) | Fila e idempotencia em memoria, com adaptador para troca | Aceito | 2 |
| [0011](ADR-0011-billing-parametrizavel.md) | Medicao de consumo sem catalogo comercial | Aceito | 2 |
| [0012](ADR-0012-pwa-offline.md) | Fila offline local sem relaxar o isolamento | Aceito | 2 |
| [0013](ADR-0013-tabelas-filhas-sem-workspace-id.md) | Tabelas filhas sem `workspace_id`, isoladas pelo pai | Aceito | 3 |
| [0014](ADR-0014-validacao-de-campos-no-banco.md) | Validacao de `custom_fields` no banco, nao na interface | Aceito | 3 |
| [0015](ADR-0015-pipelines-paralelos-e-historico.md) | Pipelines paralelos e historico gravado pelo banco | Aceito | 3 |

Ver tambem: [provisionamento.md](provisionamento.md) — estado real da
infraestrutura provisionada e passos manuais pendentes.
