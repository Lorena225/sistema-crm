# ADR-0018 — Um modelo normalizado para sete canais, com falha isolada

- **Status:** Aceito
- **Data:** 12/08/2026
- **Etapa:** 5

## Contexto

WhatsApp, Instagram, Messenger, Telegram, e-mail, webchat e SMS descrevem a
mesma coisa de sete jeitos: o Twilio manda `MessageSid` e `From`, a Meta manda
`messages[0].id` e `from`, o Telegram manda `message.message_id` e `chat.id`.
Se essa diferenca vazar para o resto do sistema, cada regra de negocio precisa
conhecer sete formatos — e a oitava integracao toca em tudo.

O descritivo tambem aponta um defeito concreto do produto substituido:
automacoes que travam apos uma falha de envio.

## Decisao

### Normalizacao na borda

`services/worker/src/canais/normalizador.js` converte todo evento para a forma
canonica, que e exatamente o formato da tabela `messages`. Depois dele,
ninguem sabe de qual provedor veio.

Evento sem identificador externo e **descartado**, com log. Sem ele nao ha
deduplicacao possivel, e a reentrega do provedor viraria mensagem repetida na
conversa. `messages` tem indice unico parcial em `external_message_id` para
fechar a mesma porta no banco.

### Fila de saida com dois tipos de falha

Cada mensagem e um job independente na fila da Etapa 2. A distincao que
importa:

- **Transitoria** (provedor fora do ar): relanca, a fila aplica backoff e
  retenta. A mensagem fica `queued` com o motivo da tentativa.
- **Definitiva** (`FalhaDefinitiva`): janela de 24h expirada, teto da conta
  atingido, canal sem transporte. Grava `failed` + `error_reason` legivel e
  **nao retenta**. Insistir daria o mesmo resultado e queimaria a reputacao do
  numero.

Falha definitiva tambem nao vira carta morta: ela ja tem destino, que e a
propria mensagem com o motivo visivel para o atendente.

O teste `falha em uma mensagem nao bloqueia as demais` existe para provar o
requisito negativo — tres mensagens, a do meio quebra, as outras saem.

### Limite por conta de canal

O Instagram corta contas que disparam demais, e o corte atinge a **conta**.
Por isso o teto de 200 automaticas/hora e por `channel_account`: uma conta
agressiva nao pode derrubar as outras do mesmo workspace. Mensagem escrita por
gente nao entra no teto — o limite existe para conter disparo automatico, nao
para calar o atendente.

### Mensagem de erro em portugues de gente

"Erro 63016" nao ajuda ninguem. O texto diz o que aconteceu e o que fazer:
*"A janela de 24 horas do WhatsApp expirou (ultima mensagem do contato ha 30
horas). Envie um template aprovado para reabrir a conversa."*

## Consequencias

- A oitava integracao e um normalizador novo, sem tocar no resto.
- Controle de taxa em memoria: com mais de uma instancia do worker, o teto
  vira 200 por instancia. Precisa migrar para armazenamento compartilhado
  junto com a fila persistente (ADR-0010) antes de escalar horizontalmente.
- O transporte real de cada canal ainda nao existe: `transportes` e um mapa
  injetado, e nesta etapa so os testes o preenchem.
