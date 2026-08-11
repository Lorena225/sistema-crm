# ADR-0011 — Medicao de consumo sem catalogo comercial

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 2

## Contexto

Valores de plano, franquias, gateway e metodo de cobranca seguem em aberto no
descritivo (secao 11). O risco classico e o esqueleto tecnico "resolver" isso
por conta propria: um enum de planos, um preco padrao numa constante, um
`if (plan === 'pro')` numa tela. Cada um desses vira uma decisao comercial
tomada por acidente, e depois defendida por inercia.

## Decisao

`usage_meter_entries` registra **consumo**, nunca preco de venda.

| Coluna | Papel |
|---|---|
| `quantity` | quanto foi consumido, na unidade da metrica |
| `provider_cost` | custo do fornecedor, na moeda original dele |
| `provider_currency` | ISO 4217; default BRL, fornecedor internacional grava USD/EUR |
| `client_rate` | valor ja convertido para BRL, sempre |
| `occurred_at` | quando o consumo aconteceu, nao quando foi registrado |

Duas escolhas que merecem explicacao:

- **`client_rate` nao tem coluna de moeda.** Nao ha outra possibilidade: a
  assinatura e cobrada em BRL. Uma coluna `client_currency` sugeriria uma
  flexibilidade que o produto nao tem e abriria espaco para inconsistencia.
- **`occurred_at`, e nao `created_at`.** Fechamento de periodo precisa saber
  quando o minuto foi consumido. Se um lote de medicao atrasa e entra no dia
  seguinte, `created_at` colocaria o consumo no mes errado.

Escrita nao tem politica RLS: quem mede e o sistema, via `service_role`.
Consumo nao e declarado pelo cliente. Leitura e liberada ao membro ativo — o
cliente enxerga o proprio gasto.

`workspaces.plan` permanece `text` livre, com default `unassigned`. Ele
identifica o plano; **nao autoriza** hardcode comercial em lugar nenhum.

## Contrato de integracao com gateway (sem escolher gateway)

O que a plataforma precisa de qualquer provedor (Stripe, Pagar.me ou outro):

1. **Assinatura recorrente por workspace**, em BRL, com identificador externo
   guardado do lado do provedor e o `workspace_id` como referencia nossa.
2. **Consumo agregado por periodo**: soma de `quantity` por `metric` e faixa
   de `occurred_at`. Essa consulta ja e servida pelo indice
   `(workspace_id, metric, occurred_at desc)`.
3. **Webhook de eventos de cobranca** — pagamento aprovado, falha, contestacao
   — recebido pelo receptor generico do worker, com assinatura verificada e
   deduplicacao por identificador do evento. O caminho ja existe (ADR-0010);
   falta apenas registrar a fonte.
4. **Credenciais cifradas** com a primitiva de criptografia do worker, nunca
   em texto plano.
5. **Idempotencia na criacao de cobranca**, com chave derivada de
   `(workspace_id, periodo)` — reprocessar um fechamento nao pode cobrar duas
   vezes.

Nada disso escolhe provedor, preco ou metodo. Sao requisitos que qualquer
candidato tera de atender.

## Consequencias

- A decisao comercial continua livre, e o dado necessario para tomar essa
  decisao ja esta sendo coletado desde agora.
- Novas metricas entram por `alter type public.usage_metric add value ...` na
  etapa que as introduzir. O enum evita que cada modulo invente sua propria
  grafia para a mesma coisa.
- Nao ha conversao de moeda implementada. Quem gravar `provider_cost` em
  moeda estrangeira e responsavel por preencher `client_rate` com a taxa
  aplicada — a politica de cambio e decisao comercial, nao tecnica.
