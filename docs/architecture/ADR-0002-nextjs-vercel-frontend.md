# ADR-0002 — Next.js na Vercel para frontend e APIs curtas

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

A plataforma precisa de uma aplicacao web autenticada, com renderizacao no
servidor (para nao vazar chaves nem consultar dados sensiveis no browser) e
de rotas curtas de API — inclusive a rota administrativa da VirtruvIA. O
descritivo v1.0 fixa Next.js na Vercel, com PWA offline nas etapas seguintes.

## Decisao

`apps/web` em Next.js 14 (App Router), deploy na Vercel.

- Sessao mantida por cookie via `@supabase/ssr`, com refresh no middleware.
- Tres clientes Supabase distintos e nao intercambiaveis:
  - `lib/supabase/client.ts` — browser, anon key, sob RLS;
  - `lib/supabase/server.ts` — Server Components e Route Handlers, anon key +
    sessao, sob RLS;
  - `lib/supabase/admin.ts` — service role, **bypassa RLS**, marcado com
    `import 'server-only'` para que o build quebre se vazar para um bundle
    de client.
- Rotas longas, filas e conexoes persistentes **nao** ficam aqui: funcao
  serverless tem limite de tempo e nao mantem WebSocket. Ver ADR-0003.

## Consequencias

- Preview deploy por PR, o que casa com a disciplina de PR por etapa.
- A separacao dos tres clientes e a barreira principal contra vazamento de
  service role — e uma barreira verificada em tempo de build, nao por revisao.
- CSS proprio, sem framework de UI, na Etapa 1: a superficie visual ainda e
  minima e nao vale fixar uma dependencia de design system antes das telas
  reais do CRM.
