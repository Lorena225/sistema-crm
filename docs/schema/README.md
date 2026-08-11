# Schema vigente

Atualizado na **Etapa 2**. Reflete `/supabase/migrations` — se divergir, a
migration esta certa e este documento esta desatualizado.

Escopo ate aqui: fundacao de multi-tenancy (Etapa 1), auditoria append-only e
medicao de consumo (Etapa 2). Nao existem ainda tabelas de CRM, canais,
automacao, IA ou BI.

## Visao geral

```
auth.users (Supabase Auth)
     |
     | user_id
     v
workspace_members ---- workspace_id ----> workspaces
     ^                                       (tenant raiz)
     |
  auth.uid() ativo aqui = condicao de acesso ao tenant

reseller_admins  (fora do modelo de tenant; acesso so server-side)

audit_log_entries    (trilha append-only; workspace_id sem FK, sobrevive ao tenant)
usage_meter_entries  (medicao de consumo; FK para workspaces)
```

## `public.workspaces`

Tenant raiz. Todo dado operacional das etapas seguintes tera `workspace_id`
apontando para ca.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `name` | `text` NOT NULL | 1 a 120 caracteres, sem espaco em branco nas pontas |
| `slug` | `text` NOT NULL | minusculas, numeros e hifen; unico por `lower(slug)` |
| `plan` | `text` NOT NULL | default `'unassigned'`. Identificador livre — a Etapa 1 nao codifica nenhuma semantica comercial |
| `status` | `workspace_status` NOT NULL | `active` (default), `suspended`, `canceled` |
| `auto_summary_on_resolve` | `boolean` NOT NULL | default `true`. Controlara o resumo automatico de conversas em todos os canais (etapa futura) |
| `created_at` | `timestamptz` NOT NULL | `now()` |

Indices: `workspaces_slug_uniq` (unico, `lower(slug)`), `workspaces_status_idx`.

## `public.workspace_members`

Liga um usuario do Supabase Auth a um workspace. **Associacao ativa aqui e a
condicao de acesso ao tenant** — e o unico predicado usado nas politicas RLS.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `workspace_id` | `uuid` NOT NULL | FK -> `workspaces(id)`, ON DELETE CASCADE |
| `user_id` | `uuid` NOT NULL | FK -> `auth.users(id)`, ON DELETE CASCADE |
| `role` | `workspace_role` NOT NULL | `owner`, `admin`, `manager`, `agent`, `viewer` (default `agent`) |
| `status` | `workspace_member_status` NOT NULL | `invited`, `active` (default), `disabled` |
| `created_at` | `timestamptz` NOT NULL | `now()` |

Restricao: `unique (workspace_id, user_id)` — um vinculo por pessoa por
workspace.

Indices: `workspace_members_workspace_id_idx`, `workspace_members_user_id_idx`
e `workspace_members_rls_lookup_idx` — indice parcial em
`(user_id, workspace_id, status) where status = 'active'`, que e exatamente o
formato da consulta feita pelos helpers de RLS em toda query da plataforma.

`role` guarda apenas os valores-base. O motor granular de permissoes
(RBAC + ABAC do Modulo F) chega na Etapa 9.

## `public.reseller_admins`

Acesso administrativo cross-workspace da VirtruvIA. **Fora do modelo de
tenant.**

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` NOT NULL | FK -> `auth.users(id)`, unico |
| `scope` | `reseller_scope` NOT NULL | `all_workspaces` |

A tabela tem exatamente as tres colunas do escopo da etapa. `created_at` foi
deliberadamente **nao** adicionado: o escopo especifica as colunas literais, e
acrescentar campo fora dele contraria a disciplina de etapa. Se auditoria de
concessao for necessaria, entra na Etapa 2 junto com `audit_log_entries`.

## `public.audit_log_entries` (Etapa 2)

Trilha de auditoria **append-only**. Esquema generico: recebe acoes de todos
os modulos futuros sem migration nova.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `workspace_id` | `uuid` NOT NULL | **sem FK**, de proposito — a trilha precisa sobreviver a exclusao do tenant |
| `actor_type` | `audit_actor_type` NOT NULL | `user`, `ai_agent`, `automation`, `reseller_admin`, `system` |
| `actor_id` | `uuid` | nulo quando `actor_type = system` |
| `action` | `text` NOT NULL | 1 a 120 caracteres (ex.: `workspace.created`) |
| `resource_type` | `text` NOT NULL | 1 a 80 caracteres (ex.: `workspace_member`) |
| `resource_id` | `uuid` | |
| `before_state` | `jsonb` | linha anterior; nulo em criacao |
| `after_state` | `jsonb` | linha resultante; nulo em exclusao |
| `ip_address` | `inet` | origem, quando a requisicao vem do PostgREST |
| `created_at` | `timestamptz` NOT NULL | `now()` |

Indices: `workspace_id`; `(workspace_id, created_at desc)` para a consulta
dominante; `(workspace_id, resource_type, resource_id)` para o historico de um
recurso; `(workspace_id, actor_type, actor_id)` para o rastro de um ator.

Sem indice GIN nos jsonb nesta etapa: sao payload de leitura, nao criterio de
filtro.

**Append-only imposto pelo banco.** Gatilhos `audit_log_entries_no_update` e
`audit_log_entries_no_delete` levantam excecao para qualquer papel, inclusive
`service_role` (que tem `BYPASSRLS`) e o dono da tabela. Ver ADR-0008.

RLS: `audit_log_entries_select_member` (SELECT para membro ativo). Nenhuma
politica de INSERT, UPDATE ou DELETE. Grant: apenas `SELECT` para
`authenticated`.

### Gatilhos de auditoria

| Tabela | Acoes gravadas |
|---|---|
| `workspaces` | `workspace.created`, `workspace.updated`, `workspace.deleted` |
| `workspace_members` | `workspace_member.created`, `.updated`, `.deleted` |
| `reseller_admins` | `reseller_admin.granted`, `.updated`, `.revoked` (workspace nulo) |

## `public.usage_meter_entries` (Etapa 2)

Medicao de consumo variavel. Registra **consumo, nao preco de venda** —
nenhum valor comercial existe no schema ou no codigo. Ver ADR-0011.

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `workspace_id` | `uuid` NOT NULL | FK -> `workspaces(id)`, ON DELETE CASCADE |
| `metric` | `usage_metric` NOT NULL | hoje: `audio_transcription_minutes` |
| `quantity` | `numeric(18,6)` NOT NULL | `>= 0` |
| `provider_cost` | `numeric(18,6)` | custo do fornecedor, na moeda dele; nulo se nao apurado |
| `provider_currency` | `char(3)` NOT NULL | ISO 4217, default `BRL` |
| `client_rate` | `numeric(18,6)` | **sempre em BRL** — nao ha coluna de moeda porque nao ha outra possibilidade |
| `occurred_at` | `timestamptz` NOT NULL | quando o consumo aconteceu, nao quando foi registrado |

Indices: `workspace_id`; `(workspace_id, metric, occurred_at desc)` para
fechamento de periodo.

RLS: `usage_meter_entries_select_member` (SELECT para membro ativo). Escrita
sem politica — quem mede e o sistema, via `service_role`. Consumo nao e
declarado pelo cliente.

## Enums

| Tipo | Valores |
|---|---|
| `workspace_status` | `active`, `suspended`, `canceled` |
| `workspace_role` | `owner`, `admin`, `manager`, `agent`, `viewer` |
| `workspace_member_status` | `invited`, `active`, `disabled` |
| `reseller_scope` | `all_workspaces` |
| `audit_actor_type` | `user`, `ai_agent`, `automation`, `reseller_admin`, `system` |
| `usage_metric` | `audio_transcription_minutes` |

## Helpers de RLS — schema `app`

O schema `app` **nao** e exposto via PostgREST (`config.toml` expoe apenas
`public` e `graphql_public`). Todas as funcoes sao `SECURITY DEFINER` com
`search_path = ''`.

| Funcao | Retorno | Uso |
|---|---|---|
| `app.is_workspace_member(uuid)` | `boolean` | Predicado de leitura das politicas de tenant |
| `app.has_workspace_role(uuid, workspace_role[])` | `boolean` | Predicado de escrita (owner/admin) |
| `app.is_reseller_admin()` | `boolean` | Somente `service_role`. Nao usada em nenhuma politica de tenant |
| `app.current_actor_type()` | `audit_actor_type` | Classifica o ator da transacao (Etapa 2) |
| `app.current_ip()` | `inet` | IP de origem via `request.headers`; nulo fora do PostgREST |
| `app.record_audit(...)` | `uuid` | **Unico** instrumento de escrita na trilha. So `service_role` |
| `app.prevent_audit_mutation()` | `trigger` | Bloqueia UPDATE e DELETE na trilha |
| `app.audit_workspaces()` / `app.audit_workspace_members()` / `app.audit_reseller_admins()` | `trigger` | Gravam a trilha das tabelas de fundacao |

`SECURITY DEFINER` aqui nao e atalho: a politica de `workspace_members`
precisa consultar `workspace_members`, o que causaria recursao infinita de
politica. A funcao executa fora da RLS e corta o ciclo.

## Politicas RLS

`ENABLE` + `FORCE ROW LEVEL SECURITY` nas tres tabelas.

### `workspaces`

| Politica | Comando | Condicao |
|---|---|---|
| `workspaces_select_member` | SELECT | `app.is_workspace_member(id)` |
| `workspaces_update_admin` | UPDATE | `app.has_workspace_role(id, {owner, admin})` (USING e WITH CHECK) |

Sem politica de INSERT e sem politica de DELETE. Criacao so por
`public.create_workspace` (ADR-0007); remocao e operacao administrativa
server-side.

### `workspace_members`

| Politica | Comando | Condicao |
|---|---|---|
| `workspace_members_select_member` | SELECT | `app.is_workspace_member(workspace_id)` |
| `workspace_members_insert_admin` | INSERT | `app.has_workspace_role(workspace_id, {owner, admin})` |
| `workspace_members_update_admin` | UPDATE | idem |
| `workspace_members_delete_admin` | DELETE | idem |

### `reseller_admins`

RLS habilitada e **nenhuma politica**, sem `GRANT` para `anon` nem
`authenticated`. Deny-by-default: uma chamada direta a API REST com anon key
recebe erro de privilegio, nao lista vazia. Ver ADR-0005.

## Grants

| Papel | `workspaces` | `workspace_members` | `reseller_admins` | `audit_log_entries` | `usage_meter_entries` |
|---|---|---|---|---|---|
| `anon` | nenhum | nenhum | nenhum | nenhum | nenhum |
| `authenticated` | SELECT, UPDATE | SELECT, INSERT, UPDATE, DELETE | nenhum | SELECT | SELECT |
| `service_role` | total | total | total | INSERT e SELECT (UPDATE/DELETE bloqueados por gatilho) | total |

## Funcoes em `public`

### `public.create_workspace(p_name text, p_slug text) -> workspaces`

`SECURITY DEFINER`. Rejeita chamada sem `auth.uid()`, cria o workspace e
insere quem chamou como `owner` ativo — tudo na mesma transacao. Unico caminho
de criacao de tenant para usuario autenticado. `EXECUTE` apenas para
`authenticated`.

### `public.log_admin_action(...) -> uuid` (Etapa 2)

`SECURITY DEFINER`, `EXECUTE` apenas para `service_role`. Ponto de entrada de
auditoria das rotas administrativas: exige `actor_id` explicito, fixa
`actor_type = reseller_admin` e delega para `app.record_audit`. Existe em
`public` porque o schema `app` nao e exposto via PostgREST. Ver ADR-0009.

## Testes reproduziveis

Ambos rodam em transacao encerrada em `ROLLBACK` e nao deixam residuo.

### `supabase/tests/rls_isolation_test.sql` (Etapa 1)

Executado em 11/08/2026 no projeto `banulwjiccwpbkwmwgla` (`sa-east-1`):

| Verificacao | Resultado |
|---|---|
| A le `workspaces` | 1 linha (`ws-a-test`) — PASS |
| A le `workspace_members` | 1 linha — PASS |
| A tenta UPDATE no workspace B | 0 linhas afetadas — PASS |
| A tenta DELETE amplo em `workspace_members` | 1 linha (so a propria) — PASS |
| A tenta INSERT direto em `workspaces` | bloqueado (`insufficient_privilege`) — PASS |
| A tenta SELECT em `reseller_admins` | bloqueado (`insufficient_privilege`) — PASS |
| Controle negativo do harness | FAIL detectado corretamente |

### `supabase/tests/etapa2_audit_billing_test.sql` (Etapa 2)

| Verificacao | Resultado |
|---|---|
| Criar workspace gera trilha automatica | 2 entradas (`workspace.created`, `workspace_member.created`) — PASS |
| Ator e `after_state` gravados | `actor=user`, `slug=e2-ws-a` — PASS |
| Trilha do workspace B invisivel para A | 0 entradas — PASS |
| UPDATE na trilha (usuario) | bloqueado (42501) — PASS |
| DELETE na trilha (usuario) | bloqueado (42501) — PASS |
| Usuario tenta chamar `app.record_audit` | bloqueado — PASS |
| A le `usage_meter_entries` | 1 linha (so a propria) — PASS |
| A tenta inserir consumo | bloqueado — PASS |
| UPDATE na trilha (papel de servico) | bloqueado pelo gatilho — PASS |
| DELETE na trilha (papel de servico) | bloqueado pelo gatilho — PASS |
| Operacao administrativa auditada | 1 entrada `reseller_admin` — PASS |
| Controle negativo do harness | FAIL detectado corretamente |

O controle negativo existe para provar que o teste e capaz de reprovar: um
harness que so sabe dizer PASS nao prova nada.

### `services/worker/test/primitivas.test.js` (Etapa 2)

13 testes, runner nativo do Node, sem dependencia externa: retry ate o
sucesso, falha isolada, crescimento e teto do backoff, deduplicacao por chave,
liberacao da chave apos falha, webhook simulado sem efeito duplicado, recusa
de evento sem id, recusa de assinatura invalida, ida e volta da criptografia,
deteccao de adulteracao, chave invalida recusada, redacao de credenciais em
log e tolerancia a referencia circular.
