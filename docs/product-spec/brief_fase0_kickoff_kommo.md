# Kommo++ VirtruvIA — Brief de Kickoff: Fase 0 (Fundação Transversal)

**Responsável principal:** Claude (revisão técnica cruzada com Manus quando aplicável).
**Origem:** extraído do "Descritivo Completo da Plataforma — Kommo++ VirtruvIA" v1.0 (11/08/2026). Este brief é autônomo — pode ser colado direto na ferramenta de desenvolvimento para iniciar a construção sem precisar do documento completo ao lado.

## Objetivo da fase

Montar a fundação transversal que todas as demais fases (Núcleo CRM, Inbox omnichannel, Automação/IA, BI/Governança, Atendimento/Integrações) vão usar: multi-tenancy, autenticação, RLS, billing recorrente, observabilidade e a base de PWA offline.

## Stack obrigatória

| Camada | Tecnologia |
|---|---|
| Frontend e APIs curtas | Next.js na Vercel, com PWA e fila offline (tarefas, notas, check-ins de campo, sincronizando ao reconectar) |
| Banco e autenticação | Supabase Postgres, schema compartilhado com `workspace_id` em toda tabela de tenant, RLS habilitado, `pgvector` provisionado (será usado por IA nas fases seguintes) |
| Tempo real e workers | Serviço persistente em Railway (ou Render como alternativa) para WebSocket, webhooks, filas, retry e jobs agendados |
| Realtime operacional | Supabase Realtime para presença, notificações e eventos — não usar como motor de BI histórico |
| Moeda base | Real brasileiro (BRL) em toda estrutura de billing e valores monetários por padrão |

## Entregáveis desta fase

1. **Multi-tenancy e autenticação**
   - Criar tabela `workspaces`: `id`, `name`, `slug`, `plan`, `status`, `auto_summary_on_resolve` (boolean, padrão `true`), `created_at`.
   - Criar tabela `workspace_members`: `id`, `workspace_id`, `user_id`, `role`, `status`, `created_at`. Valores-base de `role`: `owner`, `admin`, `manager`, `agent`, `viewer` (o motor de papéis granular do Módulo F vem na Fase 4, mas o enum base já deve existir).
   - Criar tabela `reseller_admins`: `id`, `user_id`, `scope` (`all_workspaces`) — acesso cross-workspace exclusivo da VirtruvIA, com política administrativa separada, usada só no servidor e auditada.
   - Autenticação via Supabase Auth, vinculando `auth.uid()` a `workspace_members`.

2. **RLS (Row-Level Security)**
   - Toda tabela de dados de tenant deve incluir `workspace_id`, exceto catálogos globais administrados pela VirtruvIA.
   - Política RLS: acesso permitido apenas quando existe `workspace_members` ativo ligado ao `auth.uid()` do usuário para aquele `workspace_id`.
   - Índices obrigatórios em `workspace_id` e em toda coluna usada em política RLS; campos JSONB filtráveis recebem índice GIN quando necessário.
   - Referência: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

3. **Auditoria básica**
   - Criar `audit_log_entries`: `id`, `workspace_id`, `actor_type` (`user`\|`ai_agent`\|`automation`\|`reseller_admin`\|`system`), `actor_id`, `action`, `resource_type`, `resource_id`, `before_state jsonb`, `after_state jsonb`, `ip_address`, `created_at`.
   - Esta tabela será usada por todos os módulos futuros (governança, aprovações, agentes de IA) — o esquema deve ser genérico e já estar pronto agora.

4. **Provisionamento de infraestrutura**
   - Supabase Postgres com `pgvector` habilitado (mesmo sem uso ainda) e Storage configurado.
   - Deploy inicial na Vercel.
   - Serviço persistente no Railway (ou Render) para uso futuro de WebSocket/webhooks/filas — pode começar como esqueleto funcional (health check + fila vazia) nesta fase.

5. **Abstrações transversais**
   - Definir e implementar como bibliotecas/utilitários reutilizáveis: fila com retry/backoff, webhook receiver genérico, idempotência (chave de deduplicação por evento), criptografia de credenciais (para uso futuro em `channel_accounts`, `workspace_integrations` etc.), e observabilidade (logging estruturado + métricas básicas).

6. **Billing recorrente (esqueleto)**
   - Preparar estrutura de billing recorrente por workspace e medição de minutos de transcrição, **sem congelar valores de plano** (isso é decisão pendente — ver seção "Decisões que NÃO devem ser travadas nesta fase").
   - Moeda: BRL em todos os valores monetários por padrão.

7. **Base de PWA offline**
   - Entregar esqueleto de PWA com fila offline local para tarefas, notas e check-ins de campo, sincronizando ao reconectar. Não precisa das telas completas ainda — a infraestrutura de fila offline + sync é o entregável desta fase.

## Regras de segurança e isolamento (aplicar desde o início)

- Credenciais de canais e integrações sempre armazenadas criptografadas — mesmo que ainda não haja integrações reais nesta fase, a abstração de criptografia deve existir.
- `reseller_admins` nunca deve ser acessível por política RLS padrão de tenant — política administrativa separada, auditada, uso restrito ao servidor.

## Decisões que NÃO devem ser travadas nesta fase

Estas seguem pendentes no documento completo (seção 11) e não devem ser hardcoded no código da Fase 0:
- Valores de planos e franquias (billing deve ser parametrizável, não codificado na interface).
- Quantidade/provedores de gateway de pagamento a priorizar.
- Métodos de cobrança (Pix/link apenas vs. cartão recorrente).

## Critérios de aceite da Fase 0

- [ ] Um usuário pode se autenticar e pertencer a um `workspace` via `workspace_members`.
- [ ] RLS bloqueia acesso cross-tenant em teste manual (usuário do workspace A não vê dados do workspace B).
- [ ] `reseller_admins` consegue acessar múltiplos workspaces via rota administrativa server-side, auditada em `audit_log_entries`.
- [ ] Toda ação de teste (criar workspace, adicionar membro) gera uma entrada em `audit_log_entries`.
- [ ] Fila com retry/backoff funciona em um teste de webhook simulado (falha proposital e reprocessamento).
- [ ] PWA instalável, com pelo menos uma ação (ex.: criar nota) funcionando offline e sincronizando ao voltar a conexão.
- [ ] Estrutura de billing recorrente existe no schema, mas nenhum valor de plano está fixo no código — tudo lido de configuração/tabela.

## Próxima fase

Após aceite da Fase 0, seguir para **Fase 1 — Núcleo CRM e dados configuráveis** (contatos, empresas, negócios, pipelines, campos customizados, catálogo de produtos), descrita na seção 10 do descritivo completo.
