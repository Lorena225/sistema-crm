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

Ver tambem: [provisionamento.md](provisionamento.md) — estado real da
infraestrutura provisionada e passos manuais pendentes.
