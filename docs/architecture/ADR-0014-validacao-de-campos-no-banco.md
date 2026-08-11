# ADR-0014 — Validacao de `custom_fields` no banco, nao na interface

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 3

## Contexto

`custom_fields` e um `jsonb` livre. Sem regra, ele vira o depositario de
qualquer coisa: chave com erro de digitacao que nunca mais aparece na
interface, numero gravado como texto, opcao que nao existe mais no `select`.
Depois de alguns meses isso nao se limpa — vira relatorio errado.

O escopo pede: *"valide `custom_fields` jsonb contra `field_definitions` antes
de persistir"*.

## Decisao

A validacao vive em `app.validate_custom_fields`, chamada por um gatilho
`BEFORE INSERT OR UPDATE` em `contacts`, `companies`, `deals` e
`object_records`.

Regras aplicadas:

1. **Nenhuma chave desconhecida.** Cada chave precisa existir como
   `field_definition` do mesmo escopo.
2. **Obrigatoriedade.** `is_required` sem valor recusa a gravacao.
3. **Tipo por `field_type`.** Numero e numero, booleano e booleano, data e
   conversivel, `select` esta entre as opcoes, `multiselect` e uma lista com
   todos os itens entre as opcoes, e-mail e telefone passam por formato.

### Por que no banco

Porque o cliente escreve direto via PostgREST — a RLS ja o autoriza — e
porque as proximas etapas vao escrever pelos mesmos caminhos: importacao,
automacao, agente de IA. Validacao apenas na interface protege exatamente um
caminho, e o menos perigoso deles.

A interface tambem valida (`validarPrevia`), mas com outro objetivo: dar erro
imediato ao operador em vez de esperar o round-trip. Se as duas divergirem, a
do banco vence.

### Escolhas de rigor

- **Telefone e deliberadamente permissivo** (`^[0-9()+\-\s.]{8,20}$`). Numero
  brasileiro aparece com DDI, DDD, parenteses, hifen e espaco. Recusar
  cadastro por causa de mascara e pior do que guardar com formatacao livre.
- **Campo vazio nao entra no objeto**, em vez de entrar como `null`. Chave
  ausente e chave nula sao coisas diferentes para o `jsonb`, e enviar `null`
  reprovaria na checagem de tipo de um campo opcional.
- **`ai_generated` aceita texto normalmente.** O campo existe e guarda valor;
  o que nao existe nesta etapa e a runtime que o preenche sozinho.

## Consequencias

- Alterar o `field_type` de um campo que ja tem dados pode tornar registros
  antigos invalidos na proxima gravacao. `field_schema_versions` registra a
  mudanca; a migracao dos valores existentes fica para quem alterar decidir.
- Remover uma opcao de um `select` nao apaga o valor ja gravado — so impede
  novas gravacoes com ele.
- A validacao roda por linha, entao uma importacao grande paga o custo por
  registro. Se virar gargalo, o caminho e uma versao em lote, nao afrouxar a
  regra.
