# ADR-0001 — Supabase Postgres como banco e autenticacao

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1
- **Projeto:** `kommopp-sistema-crm` (ref `banulwjiccwpbkwmwgla`), regiao `sa-east-1`, organizacao no plano Pro

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

## Regiao

O projeto roda em **`sa-east-1` (Sao Paulo)**. A operacao e inteiramente
brasileira e o produto e messenger-first: cada mensagem do inbox paga a
latencia de ida e volta ate o banco. De Sao Paulo isso e da ordem de 20 ms;
de `ca-central-1`, onde o primeiro provisionamento caiu, seria da ordem de
130 ms — diferenca que o operador sente digitando.

Regiao nao muda depois da criacao. A correcao foi feita ainda na Etapa 1,
com o banco vazio: bastou rodar as mesmas duas migrations no projeto novo,
porque todo o schema esta versionado. Depois de haver dado de cliente, a mesma
troca seria uma migracao com janela de indisponibilidade. Registro aqui como
argumento a favor da disciplina de migrations: ela transformou uma decisao
irreversivel em uma reexecucao de dez minutos.

O projeto antigo (`atuftxdqptdfbyzwkufd`) deve ser apagado pelo painel — ver
`provisionamento.md`.
