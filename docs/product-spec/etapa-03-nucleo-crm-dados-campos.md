# Etapa 3 — Núcleo CRM: dados e campos configuráveis

**Responsável:** Claude.
**Dependência:** Etapas 1 e 2 concluídas (PR #1 mesclado em 11/08/2026).
**Status:** entregue em 11/08/2026.

## Objetivo

Construir o núcleo configurável de registros e processos: campos customizados,
contatos/empresas/negócios, objetos customizados, relações e pipelines
paralelos com histórico íntegro.

## Escopo entregue

1. **Campos configuráveis** — `field_definitions` com os onze `field_type` do
   escopo, versionamento automático em `field_schema_versions` e validação de
   `custom_fields` no banco (ADR-0014).
2. **Entidades CRM** — `contacts`, `companies`, `deals` e a relação N:N
   `contact_company_links`, todas com `custom_fields jsonb` e índice GIN.
3. **Objetos customizados** — `object_types`, `object_records` e
   `object_relations` polimórficas, com integridade garantida por gatilho.
4. **Pipelines paralelos** — `pipelines`, `pipeline_stages`, `pipeline_items` e
   `pipeline_stage_history`, com histórico gravado pelo banco e
   `duration_seconds` calculado (ADR-0015).
5. **Interface** — configuração de campos com todos os tipos, CRUD das quatro
   entidades, criação de tipos de objeto, vínculo contato/empresa, criação de
   pipeline com estágios e quadro com arrastar e soltar.

## Fora de escopo (respeitado)

- Nenhuma tarefa, agendamento, campanha, identidade/merge, produto, price book
  ou item de negócio — Etapa 4.
- `ai_generation_config` é preservado, mas nada o consome: a runtime de IA não
  foi implementada.
- Nenhum campo de nicho, tabela por vertical ou schema alternativo para
  matrícula, reserva, apólice ou contrato.
- `deals.value` continua preenchido diretamente; não existe `deal_line_items`.

## Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Tabelas com nomes e colunas literais, `workspace_id`/RLS/índices, schema documentado | Atendido — quatro tabelas filhas sem `workspace_id` por decisão registrada (ADR-0013) |
| 2 | CRUD respeita isolamento e valida `custom_fields` | Atendido |
| 3 | N:N em `contact_company_links` sem duplicar cadastros | Atendido |
| 4 | Interface configura campos de todos os `field_type`, versionando cada mudança | Atendido |
| 5 | Interface cria pipeline/estágios e arrasta cards; gatilho grava histórico com `duration_seconds` | Atendido |
| 6 | Entidade mantém itens paralelos em pipelines distintos | Atendido |
| 7 | Testes verificam RLS, validação, gatilho e ordenação | Atendido — 22 verificações |

## Defeito encontrado e corrigido durante a etapa

O primeiro teste reprovou a auditoria: `before_state` e `after_state` chegavam
nulos. A causa era `if new is not null` dentro do gatilho — em PL/pgSQL, um
registro composto só é `IS NOT NULL` quando **todos** os campos são não-nulos,
e um contato sem telefone reprovava. Corrigido em
`20260811210200_etapa3_fix_audit_estado.sql`, trocando a checagem por `tg_op`.

O mesmo teste tinha um falso positivo: a tentativa de escrita cross-tenant
usava `INSERT ... SELECT`, que a RLS esvaziava antes da política — zero linhas
inseridas parecia sucesso do ataque. Reescrito com id explícito e mirando uma
tabela sem campo obrigatório, para exercitar a RLS de fato.

## Limitações conhecidas

1. `position_in_stage` é mantida pela interface; duas pessoas reordenando a
   mesma coluna simultaneamente podem gerar posições repetidas. A ordenação
   segue estável.
2. `wip_limit` é sinalização visual; bloqueio depende do motor de automações.
3. `is_won`/`is_lost` não alteram `deals.status` automaticamente — seria regra
   de negócio não definida por este escopo.
4. `editable_roles` é declarativo; o motor granular chega na Etapa 9.
5. Campos do tipo `relation` guardam o identificador, sem seletor de registro
   na interface.
6. Alterar o `field_type` de um campo com dados pode invalidar registros
   antigos na próxima gravação; a migração dos valores fica a critério de quem
   altera.

## Próxima etapa

Etapa 4 — Núcleo CRM: produtividade e comercial.
