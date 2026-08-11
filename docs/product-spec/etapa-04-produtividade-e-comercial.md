# Etapa 4 — Núcleo CRM: produtividade e comercial

**Responsável:** Claude.
**Dependência:** Etapas 1–3 concluídas (PR #2 mesclado em 11/08/2026).
**Status:** entregue em 11/08/2026.

## Escopo entregue

1. **Produtividade** — `task_types` (catálogo global do workspace),
   `task_outcome_types`, checklists, `tasks`, `task_comments` e
   `task_recurrences`. Atraso é calculado, nunca persistido.
2. **Calendário** — `calendar_integrations` e `calendar_event_links` como
   contrato e schema. Nenhum conector OAuth real, por escopo.
3. **Agendamento público** — `booking_pages` e `booking_slots`, com reserva por
   visitante sem conta através de duas funções de escopo estreito (ADR-0016).
4. **Campanhas e identidade** — `campaigns`, `campaign_members`,
   `campaign_influence`, `identity_resolution_rules` e `identity_merge_queue`,
   com detecção de duplicidade por documento, e-mail e telefone.
5. **Catálogo comercial** — `products`, `price_books`, `price_book_entries` e
   `deal_line_items`, com `line_total` gerado e `deals.value` derivado
   (ADR-0017).
6. **Telas** — tarefas, agendamento (admin e página pública), campanhas com
   fila de merge revisável, catálogo comercial e cartão do negócio com itens.

## Fora de escopo (respeitado)

- Nenhuma UI de chat, cockpit, canais, mensagens, pagamentos ou cobrança.
- Nenhum conector OAuth de calendário: só o contrato.
- Nenhuma automação, IA, resumo ou agente. `source` aceita `automação` e
  `agente_ia` no enum, mas nada os produz.
- Nenhum módulo de casos: `case` em `related_to_type` é schema reservado.
- Nenhum valor de plano, franquia, gateway ou método de pagamento.

## Critérios de aceite

| # | Critério | Situação |
|---|---|---|
| 1 | Tabelas com colunas literais, RLS e índices; catálogos no workspace certo | Atendido |
| 2 | `task_types` global sem vínculo de pipeline; tarefas, recorrências, resultados e comentários funcionam | Atendido |
| 3 | Reserva pública respeita slots/buffer e cria tarefa com `source = agendamento_publico` | Atendido |
| 4 | Campanhas registram membros/influência; fila de merge revisável | Atendido |
| 5 | Produtos e price books em BRL; entrada vence preço padrão | Atendido |
| 6 | Testes de `line_total`, recálculo em create/update/delete e edição manual sem itens | Atendido |
| 7 | Cartão do negócio exibe e edita itens sem chat | Atendido |

## Defeito encontrado e corrigido

`detect_duplicate_contacts` usava o alias `r` para a tabela de regras e também
declarava uma variável de registro `r` para o laço. Em PL/pgSQL a variável
vence o alias, então `r.workspace_id` era lido como campo de um registro ainda
não atribuído — e o erro só aparecia em execução, não na criação da função.
Corrigido em `20260811224822`, com prefixo `v_` nas variáveis.

## Limitações conhecidas

1. Sem rate limit no agendamento público: alguém pode encher a agenda com
   reservas falsas. Captcha ou confirmação por e-mail dependem de canais
   (Etapa 5).
2. Fuso fixo em `America/Sao_Paulo` na validação de janelas.
3. `task_recurrences` guarda a RRULE; a geração das ocorrências é do worker,
   em etapa futura.
4. A fila de merge registra a decisão, mas **não executa a fusão** dos
   cadastros — juntar históricos é operação destrutiva e merece etapa própria.
5. Checklists têm schema e RLS, mas ainda não aparecem na tela de tarefas.
6. `campaign_influence.weight` não é validado para somar 1 em multi-toque: a
   regra de atribuição pertence ao BI.

## Próxima etapa

Etapa 5 — Inbox omnichannel e cockpit.
