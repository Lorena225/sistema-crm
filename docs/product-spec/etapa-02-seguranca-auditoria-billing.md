# Etapa 2 — Seguranca, auditoria e billing esqueleto

**Responsavel:** Claude.
**Dependencia:** Etapa 1 concluida.
**Status:** entregue em 11/08/2026.

## Objetivo

Completar os controles transversais que sustentam todos os modulos: RLS
testada, auditoria append-only, primitivas operacionais resilientes, billing
parametrizavel e a fundacao de PWA offline.

## Escopo entregue

1. **RLS consolidada** — teste reproduzivel cobrindo leitura e escrita
   cross-tenant nas tabelas de fundacao e nas duas tabelas novas.
2. **Auditoria append-only** — `audit_log_entries` com esquema generico,
   bloqueio de UPDATE/DELETE por gatilho (vale ate para `service_role`), e
   gatilhos instrumentando `workspaces`, `workspace_members` e
   `reseller_admins`.
3. **Rota administrativa auditada** — `GET /api/admin/workspaces` grava em
   `audit_log_entries` via `public.log_admin_action`; falha ao gravar derruba
   a resposta.
4. **Primitivas transversais no worker** — fila com retry/backoff e falha
   isolada, receptor generico de webhook, idempotencia por chave de
   deduplicacao, criptografia AES-256-GCM de credenciais, logging estruturado
   com redacao e metricas em `/metrics`.
5. **Billing esqueleto** — `usage_meter_entries` medindo consumo, com BRL como
   padrao e nenhum valor comercial no schema ou no codigo. Contrato de
   integracao com gateway documentado sem escolher gateway.
6. **PWA offline** — manifesto, service worker que nao guarda API em cache,
   fila local em IndexedDB com operacoes tipadas e adiadas, sincronizacao ao
   reconectar com autorizacao revalidada sob RLS.

## Fora de escopo (respeitado)

- Nenhum preco, franquia, tier, valor de plano, fatura, gateway, Pix ou cartao.
- `tasks` e `notes` nao foram criadas — pertencem as Etapas 4 e 5. A rota de
  sincronizacao aceita a operacao e responde `persistida: false`.
- Nenhum canal, automacao, agente, CRM, SSO, exportacao, backup ou integracao.
- Nenhuma tabela alem das duas do escopo. A fila e a idempotencia ficaram em
  memoria, atras de um adaptador, justamente para nao inventar schema
  (ADR-0010).
- A RLS nao foi relaxada para viabilizar a sincronizacao offline.

## Criterios de aceite

| # | Criterio | Situacao |
|---|---|---|
| 1 | RLS bloqueia leitura e escrita cross-tenant em testes reproduziveis | Atendido — 12 verificacoes |
| 2 | Rota administrativa autorizada gera entrada em `audit_log_entries`; nao existe equivalente sem controle | Atendido |
| 3 | Criacoes/alteracoes na fundacao geram trilha append-only com ator, estados e data | Atendido — via gatilhos |
| 4 | Worker reprocessa webhook simulado com retry/backoff e idempotencia, sem duplicar o efeito externo | Atendido — teste e verificacao ao vivo |
| 5 | `usage_meter_entries` com as colunas literais, RLS, indice de `workspace_id` e nenhum valor comercial | Atendido |
| 6 | PWA instalavel; acao offline preservada e sincronizada, com autorizacao revalidada | Atendido — icones sao marcadores |
| 7 | Logs estruturados e metricas basicas sem vazamento de credenciais | Atendido — redacao testada |

## Limitacoes conhecidas

1. Fila e idempotencia em memoria: reinicio do worker perde a fila. Trocar por
   armazenamento persistente **antes** da etapa de canais (ADR-0010).
2. Icones do PWA sao marcadores gerados; substituir pelo icone da VirtruvIA.
3. `ip_address` so e preenchido quando a escrita vem do PostgREST. Operacoes do
   worker gravam com IP nulo.
4. Retencao da trilha ainda nao definida — decisao para uma etapa de operacao,
   com dado real de volume.

## Proxima etapa

Etapa 3 — Nucleo CRM: dados e campos configuraveis.
