# Schema vigente

Atualizado na **Etapa 1**. Reflete `/supabase/migrations` — se divergir, a
migration esta certa e este documento esta desatualizado.

Escopo desta etapa: apenas a fundacao de multi-tenancy. Nao existem ainda
tabelas de CRM, canais, automacao, IA, BI, auditoria ou billing.

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

## Enums

| Tipo | Valores |
|---|---|
| `workspace_status` | `active`, `suspended`, `canceled` |
| `workspace_role` | `owner`, `admin`, `manager`, `agent`, `viewer` |
| `workspace_member_status` | `invited`, `active`, `disabled` |
| `reseller_scope` | `all_workspaces` |

## Helpers de RLS — schema `app`

O schema `app` **nao** e exposto via PostgREST (`config.toml` expoe apenas
`public` e `graphql_public`). Todas as funcoes sao `SECURITY DEFINER` com
`search_path = ''`.

| Funcao | Retorno | Uso |
|---|---|---|
| `app.is_workspace_member(uuid)` | `boolean` | Predicado de leitura das politicas de tenant |
| `app.has_workspace_role(uuid, workspace_role[])` | `boolean` | Predicado de escrita (owner/admin) |
| `app.is_reseller_admin()` | `boolean` | Somente `service_role`. Nao usada em nenhuma politica de tenant |

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

| Papel | `workspaces` | `workspace_members` | `reseller_admins` |
|---|---|---|---|
| `anon` | nenhum | nenhum | nenhum |
| `authenticated` | SELECT, UPDATE | SELECT, INSERT, UPDATE, DELETE | nenhum |
| `service_role` | total | total | total |

## Funcoes em `public`

### `public.create_workspace(p_name text, p_slug text) -> workspaces`

`SECURITY DEFINER`. Rejeita chamada sem `auth.uid()`, cria o workspace e
insere quem chamou como `owner` ativo — tudo na mesma transacao. Unico caminho
de criacao de tenant para usuario autenticado. `EXECUTE` apenas para
`authenticated`.

## Teste de isolamento

`supabase/tests/rls_isolation_test.sql`, executado em 11/08/2026 no projeto
`atuftxdqptdfbyzwkufd`:

| Verificacao | Resultado |
|---|---|
| A le `workspaces` | 1 linha (`ws-a-test`) — PASS |
| A le `workspace_members` | 1 linha — PASS |
| A tenta UPDATE no workspace B | 0 linhas afetadas — PASS |
| A tenta DELETE amplo em `workspace_members` | 1 linha (so a propria) — PASS |
| A tenta INSERT direto em `workspaces` | bloqueado (`insufficient_privilege`) — PASS |
| A tenta SELECT em `reseller_admins` | bloqueado (`insufficient_privilege`) — PASS |
| Controle negativo do harness | FAIL detectado corretamente |

O ultimo item existe para provar que o teste e capaz de reprovar: um harness
que so sabe dizer PASS nao prova nada.
