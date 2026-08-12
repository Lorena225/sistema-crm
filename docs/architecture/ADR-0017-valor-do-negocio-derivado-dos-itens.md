# ADR-0017 — `deals.value` derivado dos itens, com edicao manual preservada

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 4

## Contexto

O escopo pede duas coisas que parecem se contradizer: `deals.value` deve ser
recalculado como a soma dos itens a cada criacao, alteracao ou remocao; e
"sem itens, `deals.value` e editavel manualmente".

O caso real por tras disso: negocios simples sao digitados direto ("R$ 5.000,
fechado"), e negocios detalhados sao montados item a item. O mesmo campo
precisa servir aos dois.

## Decisao

Tres pecas no banco, nenhuma na interface:

1. **`line_total` e coluna gerada** — `round(quantity * unit_price *
   (1 - discount_percent), 2)`, `stored`. A formula do escopo vive no schema, e
   nao espalhada por tela, importacao e automacao.
2. **Gatilho em `deal_line_items`** recalcula `deals.value` apos insert,
   update e delete. **Quando o ultimo item e removido, o valor nao e zerado**:
   zerar apagaria um numero que o gatilho nao tem como recuperar, e o campo
   volta a ser manual justamente nesse momento.
3. **Gatilho em `deals`** que, havendo itens, sobrepoe qualquer valor digitado
   com a soma calculada. Sem ele, uma edicao manual sobreviveria ate o proximo
   item mudar — e a pessoa veria o numero "voltar sozinho" dias depois, sem
   explicacao.

A interface reflete isso: o campo de valor manual **some** quando ha itens.
Mostrar um campo que o banco vai sobrescrever seria mentir para o operador.

### Preco: entrada antes de padrao

`app.preencher_preco_item` so age quando `unit_price` nao foi informado:
procura a entrada em `price_book_entries` para aquele par tabela/produto e, na
falta dela, usa `products.default_price`. Se nao houver nenhum dos dois, a
insercao falha — item sem preco entraria como zero e distorceria o valor do
negocio em silencio.

### `discount_percent` guarda fracao, nao porcentagem

O escopo escreve a formula como `(1 - discount_percent)`, o que so fecha se o
campo for uma fracao: `0.1` para dez por cento. O nome sugere o contrario.
Segui a formula literal, com `check` entre 0 e 1, e a interface converte:
o operador digita `10`, o banco guarda `0.1`. A alternativa — mudar a formula
para `(1 - discount_percent/100)` — contrariaria o texto do escopo.

## Consequencias

- `deals.value` nao e confiavel como campo de escrita enquanto houver itens.
  Qualquer integracao futura precisa saber disso; por isso a regra esta no
  banco, onde nenhuma integracao escapa dela.
- Remover todos os itens deixa o ultimo valor calculado. E deliberado, mas
  significa que um negocio esvaziado mantem um numero que ja nao tem lastro
  nos itens. A interface avisa que o campo voltou a ser manual.
- Precos ficam congelados no item no momento da criacao: mudar a tabela de
  precos depois nao altera negocios ja montados. Correto para proposta
  comercial, e o motivo de `unit_price` ser coluna do item e nao uma busca.
