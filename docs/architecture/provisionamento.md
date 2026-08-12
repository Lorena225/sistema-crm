# Provisionamento — estado real da infraestrutura

Atualizado em 11/08/2026 (Etapa 1). Este arquivo registra o que existe de fato,
nao o que se pretende ter. Nenhum valor de chave aparece aqui — apenas nomes de
variaveis.

## Supabase

| Item | Valor |
|---|---|
| Projeto | `kommopp-sistema-crm` |
| Ref | `banulwjiccwpbkwmwgla` |
| Organizacao | plano Pro |
| Regiao | `sa-east-1` (Sao Paulo) |
| Postgres | 17 |
| Status | ativo, migrations da Etapa 1 aplicadas |

Extensoes habilitadas: `pgcrypto`, `vector` (pgvector, provisionado sem uso —
sera utilizado pela IA nas etapas seguintes). Storage habilitado.

Migrations aplicadas (nove, correspondendo uma a uma aos arquivos do
repositorio):

1. `20260811193101_etapa1_foundation_multi_tenancy.sql`
2. `20260811193112_etapa1_create_workspace_rpc.sql`
3. `20260811194852_etapa2_audit_log.sql`
4. `20260811194907_etapa2_usage_meter.sql`
5. `20260811195709_etapa2_admin_audit_rpc.sql`
6. `20260811195819_etapa2_hardening_search_path.sql`
7. `20260811211103_etapa3_campos_e_entidades.sql`
8. `20260811211223_etapa3_pipelines.sql`
9. `20260811211423_etapa3_fix_audit_estado.sql`
10. `20260811224427_etapa4_campanhas_e_identidade.sql`
11. `20260811224547_etapa4_produtividade_e_agendamento.sql`
12. `20260811224622_etapa4_produtos_e_itens_de_negocio.sql`
13. `20260811224822_etapa4_fix_deteccao_duplicidade.sql`

### Nota sobre os carimbos de tempo

As migrations foram aplicadas pelo conector do Supabase, que gera o proprio
carimbo no momento da aplicacao — diferente do que os arquivos traziam. O
`supabase db push` compara pela versao no nome do arquivo, entao ele enxergava
nove migrations pendentes e tentava recriar tipos que ja existiam; o job de
deploy falhou por isso na primeira execucao.

Os arquivos foram renomeados para as versoes efetivamente registradas em
`supabase_migrations.schema_migrations`. Repositorio e banco voltaram a
descrever o mesmo historico, que e a premissa do ADR-0006.

Licao para as proximas etapas: aplicar a migration e nomear o arquivo com a
mesma versao, ou aplicar pelo `supabase db push` desde o inicio.

Estado verificado no banco ao fim da Etapa 4: 38 tabelas, todas com RLS ativa,
0 linhas residuais (os testes rodam em transacao com `ROLLBACK`).

Os arquivos desta etapa ja nasceram com a versao que o Supabase registrou,
seguindo a licao da Etapa 3.

### Projeto anterior a remover

O primeiro provisionamento da Etapa 1 caiu em `ca-central-1` (Canada), ref
`atuftxdqptdfbyzwkufd`, nome `sistema-crm`. As mesmas migrations foram
reaplicadas em `sa-east-1` porque a diferenca de latencia para uma operacao
brasileira e da ordem de 130 ms para 20 ms por ida e volta — e regiao nao muda
depois da criacao.

**Pendencia:** apagar o projeto `sistema-crm` (`atuftxdqptdfbyzwkufd`) pelo
painel do Supabase. Enquanto os dois existirem, a organizacao Pro cobra os dois
(US$ 10/mes cada). O projeto antigo nunca recebeu dado real — so o teste de
isolamento, que nao persiste nada.

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
4. Variaveis: `NODE_ENV=production`, `LOG_LEVEL=info`, `ENCRYPTION_KEY`
   (gerar com `openssl rand -base64 32`) e, quando houver fonte assinada,
   o segredo correspondente. A `PORT` a Railway injeta sozinha.

Render e alternativa compativel: Web Service, Node 20, mesmo start command e
mesmo health check path.

Verificado localmente:

```
GET /health -> {"status":"ok","service":"kommopp-worker","stage":"etapa-1",...}
GET /ready  -> {"status":"ready","checks":{"queue":"not_implemented",...}}
GET /nope   -> 404 {"error":"not_found"}
```

## GitHub Actions — segredos a cadastrar

Cadastrados em Settings > Secrets and variables > Actions (11/08/2026):

- `SUPABASE_ACCESS_TOKEN` — token pessoal do Supabase
- `SUPABASE_DB_PASSWORD` — senha do banco do projeto
- `SUPABASE_PROJECT_REF` — `banulwjiccwpbkwmwgla`

O job `validate` roda num Postgres limpo e nao depende de segredo nenhum; o
job `deploy` usa os tres.

## Avisos do linter do Supabase — aceitos e explicados

| Aviso | Objeto | Por que fica assim |
|---|---|---|
| `rls_enabled_no_policy` (INFO) | `public.reseller_admins` | Deny-by-default proposital. Ver ADR-0005. |
| `authenticated_security_definer_function_executable` (WARN) | `public.create_workspace` | Unico caminho de criacao de tenant; valida `auth.uid()` antes de escrever. Ver ADR-0007. |

Sao os dois unicos avisos abertos. Os dois `function_search_path_mutable` que
apareceram durante a Etapa 2 (`app.prevent_audit_mutation` e `app.current_ip`)
foram corrigidos na migration `20260811200300`, e nao ha aviso de RLS ausente
em nenhuma tabela nova.

Nenhum dos dois deve ser "corrigido" em etapa futura sem antes revisitar o ADR
correspondente.
