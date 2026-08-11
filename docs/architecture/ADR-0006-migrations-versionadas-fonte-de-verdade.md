# ADR-0006 — Migrations versionadas como unica fonte de verdade do schema

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

O programa tem varias frentes de construcao trabalhando sobre o mesmo banco ao
longo de nove etapas. Schema alterado pelo painel do Supabase e invisivel para
as outras frentes e nao sobrevive a nenhuma reconstrucao de ambiente.

## Decisao

O conteudo de `/supabase/migrations` e a definicao do schema. Consequencias
praticas:

- Nenhuma alteracao de schema pelo painel do Supabase. Nem "so um indice".
- Toda migration e commitada com o codigo que depende dela, no mesmo PR.
- Nome do arquivo segue a convencao do Supabase CLI:
  `<timestamp>_<descricao_snake_case>.sql`.
- `docs/schema/README.md` e atualizado na mesma etapa em que o schema muda.
- CI (`.github/workflows/supabase-migrations.yml`) valida as migrations num
  Postgres limpo a cada PR e aplica no projeto a cada push em `main`.

## Integracao GitHub <-> Supabase

A integracao acontece por migrations no CI, e nao por sincronizacao automatica
do painel. Motivo: o gate de revisao humana continua sendo o PR, o mesmo lugar
onde politicas RLS e testes sao revisados. Segredos (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`) ficam em GitHub Secrets, nunca
no repositorio.

## Consequencias

- Qualquer ambiente novo (branch de desenvolvimento, ambiente de teste,
  eventual migracao de regiao) e reconstruido com `supabase db push`.
- Uma correcao rapida no painel durante um incidente sai de sincronia com o
  repositorio. O procedimento correto continua sendo migration + deploy; se
  algo for aplicado a quente, precisa virar migration no mesmo dia.
