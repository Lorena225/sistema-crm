# ADR-0010 — Fila e idempotencia em memoria, com adaptador para troca

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 2

## Contexto

A etapa pede fila com retry/backoff, idempotencia por chave de deduplicacao,
receptor de webhook e observabilidade. A pergunta que fica e onde guardar o
estado: em memoria do worker, em tabela no Postgres, ou em Redis.

Tabela no Postgres seria a escolha natural — exceto que o escopo desta etapa
lista exatamente duas tabelas novas (`audit_log_entries` e
`usage_meter_entries`) e a disciplina do programa proibe acrescentar tabela
fora do escopo. Criar `job_queue` e `idempotency_keys` aqui seria inventar
schema, e schema inventado no meio do caminho e o que mais custa depois.

## Decisao

Estado em memoria do processo, atras de uma interface de armazenamento
explicita:

- `criarArmazenamentoMemoria()` implementa `obter`, `salvar`, `remover`,
  `limparExpirados`. Trocar por Postgres ou Redis e implementar essas quatro
  funcoes — quem chama nao muda.
- A fila expoe `registrar`, `enfileirar`, `bombear`, `drenar`, `cartaMorta`.
- Idempotencia com TTL de 24h, que e a janela tipica de reentrega dos
  provedores de mensageria.

Tres comportamentos que sao a razao de existir da fila:

1. **Falha isolada.** Job que estoura nao derruba o processo nem trava os
   demais. O descritivo cita literalmente automacoes que "travam apos falha de
   envio" como defeito a evitar.
2. **Backoff exponencial com jitter.** Reentrega imediata em rajada e bater na
   porta de um provedor que ja esta caindo; o jitter evita que N jobs que
   falharam juntos voltem juntos.
3. **Carta morta.** Esgotadas as tentativas, o job sai da fila mas nao some.
   Evento perdido em silencio e pior que evento com falha visivel.

Idempotencia e retry sao a mesma decisao vista de dois angulos: reprocessar so
e seguro se o efeito for aplicado uma vez. Por isso a chave de deduplicacao
envolve o **efeito**, nao o job — o job pode rodar cinco vezes, a mensagem sai
uma.

## Consequencias

- **Reinicio do worker perde a fila.** Aceitavel enquanto nao ha provedor real
  integrado; inaceitavel no dia em que houver. A troca por armazenamento
  persistente precisa acontecer **antes** da etapa de canais, e a tabela
  correspondente deve nascer no escopo daquela etapa, nao aqui.
- Uma unica instancia. Com mais de uma, a deduplicacao em memoria deixa de
  valer — duas instancias nao compartilham o mapa.
- Metricas tambem sao por processo. O formato exportado em `/metrics` ja e o
  de exposicao do Prometheus, entao o coletor agrega por instancia sem
  mudanca de codigo.
