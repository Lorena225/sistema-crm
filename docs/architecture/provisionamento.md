# Provisionamento — estado real da infraestrutura

Atualizado em 11/08/2026 (Etapa 1). Este arquivo registra o que existe de fato,
nao o que se pretende ter. Nenhum valor de chave aparece aqui — apenas nomes de
variaveis.

## Supabase

| Item | Valor |
|---|---|
| Projeto | `sistema-crm` |
| Ref | `atuftxdqptdfbyzwkufd` |
| Organizacao | plano Pro |
| Regiao | `ca-central-1` — ver pendencia abaixo |
| Postgres | 17 |
| Status | ativo, migrations da Etapa 1 aplicadas |

Extensoes habilitadas: `pgcrypto`, `vector` (pgvector, provisionado sem uso —
sera utilizado pela IA nas etapas seguintes). Storage habilitado.

Migrations aplicadas:

1. `20260811190000_etapa1_foundation_multi_tenancy.sql`
2. `20260811190100_etapa1_create_workspace_rpc.sql`

### Pendencia consciente: regiao

O projeto esta em `ca-central-1` (Canada). Para uma operacao brasileira,
`sa-east-1` (Sao Paulo) e a escolha correta: a latencia de ida e volta cai de
~130 ms para ~20 ms, e isso aparece em cada interacao de um inbox de conversas.

A regiao nao muda depois da criacao. A troca exige criar outro projeto e rodar
`supabase db push` — hoje isso custa poucos minutos, porque o banco esta vazio
e todo o schema esta versionado. Depois que houver dado de cliente, o custo
passa a ser uma migracao com janela de indisponibilidade.

**Recomendacao: decidir isso antes da Etapa 3.** Depois disso a conta muda.

## Vercel — pendente

Depende do push do repositorio. Passos, na ordem:

1. New Project > Import Git Repository > `Lorena225/sistema-crm`.
2. **Root Directory: `apps/web`** (sem isso o build nao encontra o Next.js).
3. Framework: Next.js (auto-detectado).
4. Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — **nunca** com prefixo `NEXT_PUBLIC_`
5. Deploy.

Depois do primeiro deploy, em Supabase > Authentication > URL Configuration:
adicionar o dominio da Vercel em Site URL e incluir `<dominio>/auth/callback`
em Redirect URLs. Sem isso o link de acesso por e-mail volta para localhost.

Build verificado localmente: `next build` conclui sem erro nem warning de tipo
(Next.js 14.2.35, seis rotas).

## Railway (worker) — pendente

Depende do push do repositorio.

1. New Project > Deploy from GitHub repo > `Lorena225/sistema-crm`.
2. **Root Directory: `services/worker`**.
3. Start Command e healthcheck ja vem de `services/worker/railway.json`.
4. Variavel: `NODE_ENV=production` (a `PORT` a Railway injeta sozinha).

Render e alternativa compativel: Web Service, Node 20, mesmo start command e
mesmo health check path.

Verificado localmente:

```
GET /health -> {"status":"ok","service":"kommopp-worker","stage":"etapa-1",...}
GET /ready  -> {"status":"ready","checks":{"queue":"not_implemented",...}}
GET /nope   -> 404 {"error":"not_found"}
```

## GitHub Actions — segredos a cadastrar

Em Settings > Secrets and variables > Actions:

- `SUPABASE_ACCESS_TOKEN` — token pessoal do Supabase
- `SUPABASE_DB_PASSWORD` — senha do banco do projeto
- `SUPABASE_PROJECT_REF` — `atuftxdqptdfbyzwkufd`

Enquanto esses segredos nao existirem, o job `deploy` do workflow falha; o job
`validate` (que roda num Postgres limpo) funciona sem segredo nenhum.

## Avisos do linter do Supabase — aceitos e explicados

| Aviso | Objeto | Por que fica assim |
|---|---|---|
| `rls_enabled_no_policy` (INFO) | `public.reseller_admins` | Deny-by-default proposital. Ver ADR-0005. |
| `authenticated_security_definer_function_executable` (WARN) | `public.create_workspace` | Unico caminho de criacao de tenant; valida `auth.uid()` antes de escrever. Ver ADR-0007. |

Nenhum dos dois deve ser "corrigido" em etapa futura sem antes revisitar o ADR
correspondente.
