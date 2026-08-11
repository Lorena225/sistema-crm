# ADR-0015 — Pipelines paralelos e historico gravado pelo banco

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 3

## Contexto

O descritivo aponta como defeito do produto substituido a "falta de trilhas
paralelas por negocio": um registro so pode estar em um funil, num estagio.
Na pratica isso quebra em qualquer operacao com duas frentes — um negocio
fechado que ainda precisa passar por implantacao, uma matricula que corre em
comercial e em documentacao ao mesmo tempo.

## Decisao

### O vinculo mora no item, nao na entidade

Nao existe coluna `stage_id` em `deals`. Existe `pipeline_items`, com
`unique (pipeline_id, entity_id)`: uma entrada por pipeline, quantas entradas
quantos forem os pipelines. E dai que vem a trilha paralela — nao de uma
funcionalidade extra, mas da posicao da chave.

`entity_id` e polimorfico (contato, empresa, negocio ou registro de objeto),
entao nao tem FK. A integridade e garantida por `app.enforce_pipeline_item`,
que confere tres coisas antes de aceitar: a entidade existe no workspace do
pipeline, o tipo bate com o `entity_kind` do pipeline, e o estagio pertence
aquele pipeline. Sem a terceira checagem seria possivel colocar um card numa
coluna de outro quadro.

### O historico e gravado por gatilho

`app.registrar_movimentacao_pipeline` escreve em `pipeline_stage_history` a
cada mudanca de `stage_id`, calculando `duration_seconds` a partir de
`entered_stage_at`. Um segundo gatilho reinicia `entered_stage_at` na
mudanca — sem ele, o proximo calculo sairia errado em silencio.

Poderia estar no codigo da tela. Nao esta, porque o mesmo movimento vai vir de
varias origens nas proximas etapas: arrastar o card, uma automacao, um agente
de IA, uma importacao. Historico registrado apenas por quem lembra de
registrar nao e historico.

A entrada inicial tambem gera registro, com `from_stage_id` nulo e
`duration_seconds` nulo. Sem ela, o primeiro estagio de cada item ficaria
invisivel para qualquer analise de funil.

### Historico e somente leitura

`pipeline_stage_history` nao recebe `GRANT` de escrita para `authenticated`.
Quem escreve e o gatilho. Tempo de estagio vai alimentar meta e comissao no
BI — se o proprio vendedor puder editar, o numero perde o sentido.

Como em `audit_log_entries` (ADR-0008), `pipeline_item_id` nao tem FK: o
historico de um negocio perdido nao pode desaparecer junto com a exclusao do
card.

## Consequencias

- Nenhuma consulta descobre "o estagio de um negocio" olhando so a tabela
  `deals`. Precisa passar por `pipeline_items`, e a resposta pode ser mais de
  uma. E o preco correto da funcionalidade.
- `position_in_stage` e mantida pela interface ao soltar o card. Duas pessoas
  reordenando a mesma coluna ao mesmo tempo podem produzir posicoes
  repetidas; a ordenacao continua estavel, mas a reconciliacao fina fica para
  quando houver presenca em tempo real.
- `wip_limit` e sinalizacao visual: a coluna fica marcada quando estoura. O
  bloqueio automatico depende do motor de automacoes, de etapa futura.
- `is_won` e `is_lost` existem no estagio, mas **nao** alteram
  `deals.status` automaticamente. Ligar as duas coisas seria decidir regra de
  negocio que o escopo desta etapa nao define.
