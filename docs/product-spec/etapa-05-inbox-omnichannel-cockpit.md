# Etapa 5 — Inbox omnichannel e cockpit

**Responsável:** Claude (revisão técnica recomendada: Manus).
**Dependência:** Etapas 1–4 concluídas (PR #3 mesclado em 12/08/2026).
**Status:** entregue em 12/08/2026, com limitações listadas abaixo.

## Escopo entregue

1. **Schema completo** — as 11 tabelas do escopo com colunas literais, RLS,
   índices e credenciais protegidas por três barreiras (ADR-0019).
2. **Normalização de canais** — Twilio (WhatsApp e SMS), Meta (Instagram e
   Messenger), Telegram, e-mail e webchat convertidos para uma forma canônica.
3. **Fila de saída** — retry com backoff, falha isolada por mensagem e
   distinção entre falha transitória e definitiva (ADR-0018).
4. **Twilio como BSP** — provisionamento de subconta via
   `POST /2010-04-01/Accounts.json`, com credenciais cifradas.
5. **Limite por conta** — 200 mensagens automáticas/hora por
   `channel_account` no Instagram; mensagem humana não entra no teto.
6. **Janela do WhatsApp** — falha explícita com texto que diz o que fazer.
7. **Cockpit de três colunas** — fila, thread e cartão operacional com as
   ações de CRM sem sair do chat.
8. **Comportamentos no banco** — resposta humana desliga o bot; transcrição
   mede consumo; resolver gera resumo conforme a flag global.

## Fora de escopo (respeitado)

- Twilio Voice, URA e filas de chamada — Etapa 6. `voice_calls` existe apenas
  como schema.
- Agentes, copiloto, automações, pagamentos e cobrança.
- Alteração de `auto_summary_on_resolve` por interface — é prerrogativa de
  Owner/Admin e entra com a governança da Etapa 9.
- WhatsApp pessoal de vendedor: `agent_numbers` guarda número corporativo,
  operado pela plataforma.
- Login e senha do Console Twilio nunca são pedidos nem armazenados.

## Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Tabelas com nomes/colunas literais, RLS e credenciais cifradas | Atendido |
| 2 | `channel_account` whatsapp gera subconta Twilio com credenciais cifradas | Atendido no worker; **não acionado por interface** |
| 3 | Webhooks normalizam e fila registra queued/sent/delivered/read/failed; falha isolada | Atendido |
| 4 | WhatsApp por Twilio com múltiplas contas/agentes e diagnóstico | Parcial — schema e primitivas prontos, onboarding guiado não entregue |
| 5 | Cockpit de três colunas com ações de CRM sem sair do chat | Atendido |
| 6 | Resposta humana desativa o bot; conversa associa negócio sem duplicar contato | Atendido |
| 7 | Áudio transcrito, consumo medido, resumo conforme a flag | Parcial — medição e resumo prontos; transcritor real não integrado |
| 8 | Testes de RLS, falha de entrega, limite, bot e associação CRM | Atendido |

## Limitações conhecidas

1. **Transporte real de canal não existe.** `transportes` é um mapa injetado
   e só os testes o preenchem. Nenhuma mensagem sai de verdade ainda.
2. **Onboarding guiado e diagnóstico de qualidade não entregues.** As tabelas
   `channel_quality_events` e `message_templates` existem e estão isoladas,
   mas não há tela.
3. **Transcrição assíncrona não integrada.** A fila (índice parcial) e a
   medição estão prontas; falta o provedor de transcrição.
4. **WebSocket próprio não implementado.** O tempo real do cockpit usa
   Supabase Realtime, provisionado desde a Etapa 1. O WebSocket do worker
   entra quando houver transporte real de canal.
5. **Controle de taxa em memória** — com mais de uma instância, o teto vira
   200 por instância. Migrar junto com a fila persistente (ADR-0010).
6. **Rotação de token de subconta** sem procedimento definido. Precisa entrar
   antes do primeiro cliente real.

## Próxima etapa

Etapa 6 — Voz e telefonia corporativa.
