# Schema vigente

Atualizado na **Etapa 5**. Reflete `/supabase/migrations` — se divergir, a
migration esta certa e este documento esta desatualizado.

Escopo ate aqui: fundacao de multi-tenancy (Etapa 1), auditoria append-only e
medicao de consumo (Etapa 2), nucleo CRM configuravel e pipelines (Etapa 3),
produtividade, agendamento, campanhas, identidade e catalogo comercial
(Etapa 4). Nao existem ainda tabelas de canais, automacao, IA, casos ou BI.

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

## Nucleo CRM (Etapa 3)

### `public.field_definitions`

Metadados dos campos customizados. E contra esta tabela que `custom_fields` e
validado antes de persistir (ADR-0014).

| Coluna | Tipo | Regra |
|---|---|---|
| `id` | `uuid` PK | |
| `workspace_id` | `uuid` NOT NULL | FK -> `workspaces`, cascade |
| `entity_kind` | `entity_kind` NOT NULL | `contact`, `company`, `deal`, `object_type` |
| `object_type_id` | `uuid` | obrigatorio quando `entity_kind = object_type`, nulo nos demais |
| `key` | `text` NOT NULL | minusculas, numeros e sublinhado |
| `label` | `text` NOT NULL | 1 a 120 caracteres |
| `field_type` | `field_type` NOT NULL | os onze tipos do escopo |
| `options` | `jsonb` NOT NULL | obrigatorio em `select` e `multiselect` |
| `ai_generation_config` | `jsonb` NOT NULL | preservado; nada o consome nesta etapa |
| `is_required` | `boolean` NOT NULL | |
| `is_filterable` | `boolean` NOT NULL | |
| `position` | `integer` NOT NULL | ordem no formulario |
| `editable_roles` | `text[]` NOT NULL | declarativo; o motor de permissoes e da Etapa 9 |
| `sensitivity_level` | `field_sensitivity` NOT NULL | `none`, `pii`, `financial` |
| `created_at` | `timestamptz` NOT NULL | |

Indices: unico em `(workspace_id, entity_kind, coalesce(object_type_id, uuid zero), lower(key))`
— o `coalesce` permite que dois objetos diferentes tenham ambos um campo `codigo`;
`workspace_id`; `(workspace_id, entity_kind, object_type_id, position)`.

### `public.field_schema_versions`

`id`, `field_definition_id`, `version`, `change_type` (`created`/`updated`/`deleted`),
`changed_by`, `created_at`. Unico em `(field_definition_id, version)`.

Escrita apenas pelo gatilho `field_definitions_versionamento`; `authenticated`
so tem `SELECT`. `field_definition_id` **sem FK**: a versao `deleted` nao pode
se apagar junto com o que ela registra.

### `public.contacts`, `public.companies`, `public.deals`

| Tabela | Colunas |
|---|---|
| `contacts` | `id`, `workspace_id`, `name`, `email`, `phone`, `owner_id`, `source`, `custom_fields`, `created_at`, `updated_at` |
| `companies` | `id`, `workspace_id`, `name`, `domain`, `owner_id`, `custom_fields`, `created_at`, `updated_at` |
| `deals` | `id`, `workspace_id`, `title`, `value`, `currency` (default `BRL`), `contact_id`, `company_id`, `owner_id`, `custom_fields`, `status` (`open`/`won`/`lost`), `created_at`, `updated_at` |

As tres, mais `object_records`, tem `custom_fields jsonb NOT NULL DEFAULT '{}'`
com **indice GIN** (`jsonb_path_ops`) e dois gatilhos: validacao de
`custom_fields` (BEFORE) e auditoria (AFTER).

`deals.value` e preenchido diretamente. Itens de negocio sao da Etapa 4 e ainda
nao alteram este valor.

### `public.contact_company_links`

`contact_id`, `company_id`, `role`. PK composta `(contact_id, company_id)`.
Uma pessoa em varias empresas e uma empresa com varios contatos, sem duplicar
cadastro. Sem `workspace_id` — ver ADR-0013. O `with check` da politica exige
que contato e empresa estejam no **mesmo** workspace.

### `public.object_types` / `object_records` / `object_relations`

| Tabela | Colunas |
|---|---|
| `object_types` | `id`, `workspace_id`, `name` (unico por workspace), `icon`, `description`, `created_by`, `created_at` |
| `object_records` | `id`, `workspace_id`, `object_type_id`, `title`, `owner_id`, `custom_fields`, `created_at`, `updated_at` |
| `object_relations` | `id`, `workspace_id`, `from_kind`, `from_id`, `to_kind`, `to_id`, `relation_label` |

`object_relations` e polimorfica nos dois lados, entao nao tem FK; o gatilho
`object_relations_valida_alvos` confere que origem e destino existem no mesmo
workspace. Unico em `(workspace_id, from_kind, from_id, to_kind, to_id, coalesce(relation_label,''))`,
e proibida a autorreferencia.

## Pipelines (Etapa 3)

| Tabela | Colunas |
|---|---|
| `pipelines` | `id`, `workspace_id`, `name`, `entity_kind`, `object_type_id`, `is_default`, `created_by`, `created_at` |
| `pipeline_stages` | `id`, `pipeline_id`, `name`, `position`, `color`, `is_won`, `is_lost`, `probability`, `wip_limit`, `created_at` |
| `pipeline_items` | `id`, `pipeline_id`, `stage_id`, `entity_kind`, `entity_id`, `position_in_stage`, `entered_stage_at`, `assigned_to`, `created_at`, `updated_at` |
| `pipeline_stage_history` | `id`, `pipeline_item_id`, `from_stage_id`, `to_stage_id`, `moved_by`, `moved_at`, `duration_seconds` |

`pipeline_items` tem `unique (pipeline_id, entity_id)`: uma entrada por
pipeline, e por isso a mesma entidade pode correr em varios pipelines ao mesmo
tempo. Um estagio nao pode ser `is_won` e `is_lost` simultaneamente. Apenas um
pipeline `is_default` por escopo (indice parcial).

Tres gatilhos em `pipeline_items`: valida (entidade existe, tipo bate, estagio
pertence ao pipeline), marca `entered_stage_at` na mudanca, e registra o
historico. `pipeline_stage_history` e somente leitura para `authenticated` —
ver ADR-0015.

## Produtividade e agendamento (Etapa 4)

| Tabela | Colunas |
|---|---|
| `task_types` | `id`, `workspace_id`, `code`, `name`, `default_description`, `category`, `default_duration_minutes`, `default_priority`, `color`, `requires_outcome`, `is_active` |
| `task_outcome_types` | `id`, `workspace_id`, `task_type_id`, `code`, `label`, `is_positive` |
| `task_checklist_templates` | `id`, `task_type_id`, `label` |
| `task_checklist_template_items` | `id`, `task_checklist_template_id`, `label`, `"order"` |
| `tasks` | `id`, `workspace_id`, `task_type_id`, `title`, `description`, `related_to_type`, `related_to_id`, `assigned_to`, `created_by`, `due_at`, `reminder_at`, `priority`, `status`, `completed_at`, `outcome_type_id`, `outcome_notes`, `source` |
| `task_comments` | `id`, `task_id`, `author_id`, `body`, `created_at` |
| `task_recurrences` | `id`, `task_type_id`, `recurrence_rule`, `related_to_type`, `related_to_id`, `assigned_to`, `next_generation_at` |
| `calendar_integrations` | `id`, `user_id`, `provider`, `external_calendar_id`, `sync_direction` |
| `calendar_event_links` | `id`, `task_id`, `calendar_integration_id`, `external_event_id` |
| `booking_pages` | `id`, `workspace_id`, `user_id`, `team_id`, `slug`, `title`, `default_duration_minutes`, `buffer_between_meetings`, `task_type_id` |
| `booking_slots` | `id`, `booking_page_id`, `day_of_week`, `date`, `start_time`, `end_time`, `is_available` |

**`task_types` e catalogo global do workspace** — sem FK de pipeline ou
departamento, por escopo: amarrar "ligação" a um funil impediria o tipo de
existir no resto da operacao.

**Atraso nao e coluna.** E `due_at < now()` com `status = 'pendente'`,
calculado na consulta. Persistir exigiria um job varrendo a tabela e produziria
estado errado entre duas varreduras. Indice parcial
`tasks_vencimento_idx (workspace_id, due_at) where status = 'pendente'`.

**`calendar_integrations` pertence ao usuario, nao ao workspace** — a agenda
pessoal atravessa os workspaces de que a pessoa participa. A politica usa
`user_id = auth.uid()` diretamente, sem passar por `workspace_members`.

**`booking_slots`** aceita `day_of_week` **ou** `date`, nunca os dois: um
`check` garante isso, porque os dois juntos seriam ambiguos e nenhum dos dois
nao definiria quando o slot existe.

**`booking_pages.slug` e unico globalmente**, e nao por workspace: a URL
publica `/agendar/<slug>` nao carrega o tenant.

## Campanhas e identidade (Etapa 4)

| Tabela | Colunas |
|---|---|
| `campaigns` | `id`, `workspace_id`, `name`, `channel`, `type`, `budget` (BRL), `start_date`, `end_date`, `utm_source`, `utm_medium`, `utm_campaign`, `status` |
| `campaign_members` | `id`, `campaign_id`, `contact_id`, `deal_id`, `status`, `added_at` |
| `campaign_influence` | `id`, `deal_id`, `campaign_id`, `influence_type`, `weight` |
| `identity_resolution_rules` | `id`, `workspace_id`, `match_fields` (jsonb + GIN), `match_type`, `auto_merge_threshold` |
| `identity_merge_queue` | `id`, `workspace_id`, `candidate_contact_id`, `existing_contact_id`, `confidence_score`, `status`, `reviewed_by` |

`public.detect_duplicate_contacts(workspace_id, contact_id)` compara documento
(0.98), e-mail (0.90) e telefone normalizado (0.75) e **enfileira candidatos**,
sem fundir nada. A hierarquia dos pesos reflete quanto cada campo identifica:
telefone e reaproveitado, e-mail e compartilhado, documento nao.

## Catalogo comercial (Etapa 4)

| Tabela | Colunas |
|---|---|
| `products` | `id`, `workspace_id`, `name`, `sku`, `default_price`, `currency` (default `BRL`), `is_active` |
| `price_books` | `id`, `workspace_id`, `name`, `currency` (default `BRL`), `is_default` |
| `price_book_entries` | `id`, `price_book_id`, `product_id`, `unit_price` |
| `deal_line_items` | `id`, `deal_id`, `product_id`, `price_book_id`, `quantity`, `unit_price`, `discount_percent`, `line_total` |

`line_total` e **coluna gerada**:
`round(quantity * unit_price * (1 - discount_percent), 2)`.
`discount_percent` guarda **fracao** (0.1 = dez por cento), seguindo a formula
literal do escopo; a interface converte da porcentagem digitada.

Tres gatilhos sustentam a regra (ADR-0017): preenchimento de preco (entrada do
price book antes do preco padrao), recalculo de `deals.value` a cada mudanca de
item, e sobreposicao do valor manual enquanto houver itens. Sem itens,
`deals.value` volta a ser editavel e **nao** e zerado.

## Inbox omnichannel (Etapa 5)

| Tabela | Colunas |
|---|---|
| `channel_accounts` | `id`, `workspace_id`, `channel_type`, `external_account_id`, `display_name`, `credentials`, `status`, `created_at` |
| `agent_numbers` | `id`, `channel_account_id`, `agent_id`, `phone_number` |
| `conversations` | `id`, `workspace_id`, `channel_account_id`, `contact_id`, `company_id`, `deal_id`, `status`, `assigned_to`, `is_bot_active`, `last_message_at`, `sla_due_at`, `created_at` |
| `messages` | `id`, `conversation_id`, `direction`, `sender_type`, `content`, `media_url`, `media_type`, `duration_seconds`, `transcript`, `external_message_id`, `delivery_status`, `error_reason`, `created_at` |
| `message_templates` | `id`, `workspace_id`, `channel_account_id`, `name`, `body`, `approval_status`, `category` |
| `channel_quality_events` | `id`, `channel_account_id`, `event_type`, `detail`, `created_at` |
| `voice_calls` | `id`, `conversation_id`, `direction`, `from_number`, `to_number`, `agent_id`, `recording_url`, `duration_seconds`, `transcript`, `ivr_path`, `created_at` |
| `sla_policies` | `id`, `workspace_id`, `channel_type`, `first_response_minutes`, `resolution_minutes` |
| `notes` | `id`, `workspace_id`, `related_to_type`, `related_to_id`, `author_id`, `body`, `is_pinned`, `created_at` |
| `conversation_summaries` | `id`, `conversation_id`, `summary_text`, `key_points`, `generated_at`, `generated_by` |
| `message_reactions` | `id`, `message_id`, `reactor_type`, `reactor_id`, `emoji`, `created_at` |

### Protecoes de `channel_accounts.credentials`

Tres barreiras (ADR-0019): cifragem AES-256-GCM antes de gravar; restricao
`channel_accounts_credenciais_cifradas` exigindo o prefixo `v1:` — o Postgres
recusa credencial crua mesmo digitada no painel; e `GRANT` **por coluna**, de
modo que `authenticated` nao recebe `SELECT` em `credentials`.

### Indices que carregam decisao

- `messages_externo_uniq` — unico parcial em `external_message_id`: reentrega
  do provedor nao vira mensagem duplicada.
- `messages_transcricao_pendente_idx` — parcial em audios sem transcricao, que
  e a fila que o transcritor assincrono consome.
- `conversations_sla_idx` — parcial nas nao resolvidas, para o painel de SLA.

### Gatilhos

| Gatilho | O que faz |
|---|---|
| `messages_processa` | Atualiza `last_message_at`; **desliga `is_bot_active` quando a mensagem e `outbound` de `agent`**; reabre conversa resolvida ao receber mensagem do contato; define `sla_due_at` pela politica do canal |
| `messages_medicao` | Ao chegar `transcript`, grava `usage_meter_entries` com `duration_seconds / 60` — o custo e da transcricao, nao do audio |
| `conversations_resumo` | Ao resolver, le `workspaces.auto_summary_on_resolve` e cria `conversation_summaries` com `generated_by = auto_on_resolve` |

O resumo automatico nasce com marcador explicito (`Resumo automatico pendente
de geracao`). Quem escreve o texto e a runtime de IA da Etapa 8 — inventar um
resumo agora seria pior do que nao ter.

## Enums

| Tipo | Valores |
|---|---|
| `workspace_status` | `active`, `suspended`, `canceled` |
| `workspace_role` | `owner`, `admin`, `manager`, `agent`, `viewer` |
| `workspace_member_status` | `invited`, `active`, `disabled` |
| `reseller_scope` | `all_workspaces` |
| `audit_actor_type` | `user`, `ai_agent`, `automation`, `reseller_admin`, `system` |
| `usage_metric` | `audio_transcription_minutes` |
| `entity_kind` | `contact`, `company`, `deal`, `object_type` |
| `field_type` | `text`, `number`, `currency`, `date`, `boolean`, `select`, `multiselect`, `relation`, `email`, `phone`, `ai_generated` |
| `field_sensitivity` | `none`, `pii`, `financial` |
| `field_change_type` | `created`, `updated`, `deleted` |
| `deal_status` | `open`, `won`, `lost` |
| `task_category` | `ligação`, `reunião`, `visita`, `e-mail`, `follow_up`, `administrativa`, `entrega`, `outro` |
| `task_priority` | `baixa`, `média`, `alta`, `urgente` |
| `task_status` | `pendente`, `em_andamento`, `concluída`, `cancelada` |
| `task_source` | `manual`, `automação`, `agente_ia`, `gatilho_de_etapa`, `agendamento_publico` |
| `related_to_type` | `contact`, `company`, `deal`, `case`, `campaign` |
| `sync_direction` | `bidirectional`, `push_only` |
| `campaign_type` | `pago`, `organico`, `offline` |
| `campaign_member_status` | `alvo`, `respondeu`, `convertido` |
| `influence_type` | `primeiro_toque`, `ultimo_toque`, `multi_toque` |
| `identity_match_type` | `exact`, `fuzzy` |
| `merge_status` | `pending_review`, `auto_merged`, `rejected` |

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
| `app.validate_custom_fields(uuid, entity_kind, uuid, jsonb)` | `void` | Valida `custom_fields` contra `field_definitions` (Etapa 3) |
| `app.enforce_custom_fields()` | `trigger` | Aplica a validacao nas quatro tabelas de registro |
| `app.version_field_definition()` | `trigger` | Escreve `field_schema_versions` |
| `app.audit_registro_crm()` | `trigger` | Auditoria das entidades, gravando as **chaves** de `custom_fields`, nunca os valores |
| `app.check_relation_target(uuid, entity_kind, uuid)` | `boolean` | Confere existencia de alvo polimorfico no workspace |
| `app.enforce_relation_targets()` / `app.enforce_pipeline_item()` | `trigger` | Integridade das referencias polimorficas |
| `app.registrar_movimentacao_pipeline()` / `app.marcar_entrada_estagio()` | `trigger` | Historico de estagio e `entered_stage_at` |

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

### `supabase/tests/etapa3_crm_test.sql` (Etapa 3)

22 verificacoes: versionamento de campo na criacao e na alteracao; recusa de
campo obrigatorio ausente, chave desconhecida e valor fora das opcoes;
auditoria gravando chaves sem copiar valores; estado anterior no update;
N:N sem duplicar cadastro; relacao entre negocio e objeto customizado e recusa
de alvo inexistente; historico na entrada do pipeline; calculo de
`duration_seconds`; reinicio de `entered_stage_at`; mesma entidade em pipelines
paralelos; recusa de item duplicado e de tipo incompativel; ordenacao por
`position_in_stage`; historico nao editavel; e escrita cross-tenant bloqueada
com 42501 em `companies`, `pipeline_stages` e `pipeline_items`.

A verificacao cross-tenant mira `companies`, e nao `contacts`, de proposito:
em `contacts` o gatilho de campo obrigatorio dispara antes da politica e o
teste passaria sem nunca exercitar a RLS.

### `supabase/tests/etapa4_produtividade_comercial_test.sql` (Etapa 4)

18 verificacoes: produto nasce em BRL; entrada do price book vence o preco
padrao; sem entrada usa `products.default_price`; `deals.value` recalculado na
criacao, na alteracao com desconto e na remocao; valor manual sobreposto com
itens e respeitado sem itens; reserva publica por visitante anonimo; buffer
recusando horario colado; horario fora da janela recusado; horario livre apos o
buffer aceito; anonimo bloqueado nas tabelas; pagina publica legivel pela
funcao; reserva criando tarefa, contato e negocio; atraso calculado; campanha
com membro e influencia; duplicata por e-mail na fila revisavel; e isolamento
cross-tenant em tarefas, campanhas, fila de merge e escrita de catalogo (42501).

### `services/worker/test/primitivas.test.js` (Etapa 2)

13 testes, runner nativo do Node, sem dependencia externa: retry ate o
sucesso, falha isolada, crescimento e teto do backoff, deduplicacao por chave,
liberacao da chave apos falha, webhook simulado sem efeito duplicado, recusa
de evento sem id, recusa de assinatura invalida, ida e volta da criptografia,
deteccao de adulteracao, chave invalida recusada, redacao de credenciais em
log e tolerancia a referencia circular.
