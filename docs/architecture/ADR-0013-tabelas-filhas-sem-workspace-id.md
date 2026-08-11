# ADR-0013 — Tabelas filhas sem `workspace_id`, isoladas pelo pai

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 3

## Contexto

Duas regras do programa colidem nesta etapa.

A disciplina de repositorio diz: *"toda tabela de tenant inclui `workspace_id`
e indice correspondente"*. E diz tambem: *"nao invente, renomeie, resuma ou
acrescente campos/tabelas fora do schema desta etapa"*.

Quatro tabelas da Etapa 3 nao tem `workspace_id` na lista de colunas do
escopo: `contact_company_links` (contact_id, company_id, role),
`field_schema_versions`, `pipeline_stages` e `pipeline_items`. Acrescentar a
coluna cumpriria a primeira regra e violaria a segunda.

## Decisao

Seguir a lista literal de colunas e derivar o isolamento do registro pai.

| Tabela | Caminho ate o workspace |
|---|---|
| `contact_company_links` | `contacts.workspace_id` |
| `field_schema_versions` | `field_definitions.workspace_id` |
| `pipeline_stages` | `pipelines.workspace_id` |
| `pipeline_items` | `pipelines.workspace_id` |

A politica RLS usa `exists (...)` sobre o pai, chamando o mesmo
`app.is_workspace_member`. As colunas de FK usadas nessas politicas estao
indexadas, que e o que a regra de indice realmente protege — o custo do
`exists` por linha.

A escolha pende para a instrucao mais especifica (a lista de colunas desta
etapa) sobre a geral, e o isolamento continua garantido. Nao ha caminho pelo
qual um membro do workspace A alcance uma linha filha do workspace B.

`contact_company_links` merece uma nota: o `with check` confere que **contato
e empresa pertencem ao mesmo workspace**. Sem essa juncao, alguem poderia
ligar um contato proprio a uma empresa de outro tenant e usar o vinculo para
descobrir que ela existe.

## Consequencias

- Cada leitura dessas tabelas paga uma subconsulta ao pai. Com os indices em
  `contact_id`, `field_definition_id`, `pipeline_id` e `stage_id`, o custo e
  uma busca por indice, nao uma varredura.
- Uma consulta que precise agrupar itens de pipeline por workspace tem de
  passar por `pipelines`. E o preco de nao desnormalizar.
- **Verificado, nao presumido.** O teste da etapa tenta escrever em
  `pipeline_stages` e `pipeline_items` de outro tenant e recebe 42501 nos dois
  casos. Politica derivada errada falha em silencio — por isso o teste mira
  especificamente as tabelas filhas.
- Se uma etapa futura mostrar que o `exists` custa caro em volume real, a
  desnormalizacao entra por migration propria, com a coluna preenchida por
  gatilho a partir do pai — nunca preenchida pela aplicacao, que poderia
  divergir.
