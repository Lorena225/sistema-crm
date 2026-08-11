# ADR-0001 — Supabase Postgres como banco e autenticacao

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1
- **Projeto:** `sistema-crm` (ref `atuftxdqptdfbyzwkufd`), organizacao no plano Pro

## Contexto

O Kommo++ e multi-tenant com isolamento obrigatorio por linha, precisa de
autenticacao pronta, Storage, e de `pgvector` para as fases de IA (RAG de
agentes, busca semantica). O descritivo v1.0 ja fixa Supabase como camada de
banco e autenticacao.

## Decisao

Usar Supabase Postgres (Postgres 17) como banco unico, com:

- **Supabase Auth** como provedor de identidade; `auth.uid()` e a chave que
  liga um usuario a `workspace_members`.
- **RLS nativa do Postgres** como mecanismo de isolamento de tenant.
- **`pgvector`** provisionado ja na Etapa 1, no schema `extensions`, sem
  nenhuma funcionalidade de IA construida agora — evita uma migration de
  extensao no meio de uma fase de produto.
- **Supabase Storage** habilitado para anexos de conversas e importacoes
  (uso comeca em etapas posteriores).
- **Supabase Realtime** reservado para presenca, notificacoes e eventos
  operacionais. **Nao** e motor de BI historico: relatorio e agregacao
  historica sao responsabilidade do BI (etapa propria).

## Consequencias

- O isolamento passa a viver no banco, nao apenas na aplicacao. Um bug de
  query no frontend nao vaza tenant.
- Ganha-se Auth, Storage, Realtime e API REST sem construir nada disso.
- Assume-se acoplamento ao Supabase. A mitigacao e que tudo abaixo da
  superficie e Postgres puro (SQL, RLS, funcoes) — portavel para qualquer
  Postgres gerenciado; o que ficaria para reescrever e Auth e Storage.
- A `service role key` bypassa RLS por definicao: ela so pode existir no
  servidor. Ver ADR-0005.

## Ponto em aberto (decisao de infraestrutura)

O projeto foi provisionado na regiao **`ca-central-1` (Canada)**. Para uma
operacao 100% brasileira, `sa-east-1` (Sao Paulo) reduz a latencia de ida e
volta de ~130 ms para ~20 ms — diferenca perceptivel num inbox de conversas em
tempo real. A regiao nao e alteravel apos a criacao: mudar exige criar outro
projeto e reaplicar as migrations (barato agora, caro depois que houver dado).
Registrado aqui como pendencia consciente. Ver `provisionamento.md`.
