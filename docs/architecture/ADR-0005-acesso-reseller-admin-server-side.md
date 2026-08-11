# ADR-0005 — Acesso reseller_admin server-side, deny-by-default

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

A VirtruvIA e reseller e super admin da plataforma: precisa provisionar,
acompanhar saude, dar suporte e faturar atravessando workspaces. Esse e o
acesso mais perigoso do sistema — por definicao ele ignora o isolamento de
tenant que sustenta tudo o mais.

## Decisao

`public.reseller_admins` fica com RLS habilitada e **nenhuma politica**, sem
`GRANT` para `anon` nem para `authenticated`.

O efeito e deny-by-default em duas camadas: mesmo que alguem chame
`/rest/v1/reseller_admins` direto com a anon key e um JWT valido, a resposta e
erro de privilegio — nao uma lista vazia. A tabela so e legivel por
`service_role`, que existe apenas no servidor.

O caminho administrativo e:

1. `GET /api/admin/workspaces` (Route Handler, server-side);
2. identifica o usuario pela sessao (anon key, sob RLS);
3. consulta `reseller_admins` com service role;
4. quem nao consta recebe **404**, nao 403 — a existencia da rota nao e
   confirmada para terceiros;
5. quem consta recebe o resultado ja filtrado. A service role nunca sai do
   servidor.

Nenhuma politica RLS de tenant menciona `reseller_admins`: o acesso
administrativo e um caminho separado, nao uma excecao embutida nas politicas
normais. Isso mantem as politicas de tenant simples de auditar.

## Consequencias

- Existe uma chave que bypassa toda a RLS. A mitigacao e mantê-la em uma unica
  fronteira (`lib/supabase/admin.ts`, com `import 'server-only'`) e nunca
  prefixar a variavel com `NEXT_PUBLIC_`.
- O linter do Supabase reporta `rls_enabled_no_policy` em `reseller_admins`.
  E o comportamento pretendido, nao um defeito. Registrado aqui para nao ser
  "corrigido" por engano em etapa futura.
- **Pendente da Etapa 2:** toda chamada administrativa precisa gravar em
  `audit_log_entries` com `actor_type = 'reseller_admin'`. Ate la o caminho
  esta preparado, porem nao auditado — e por isso nao ha nenhuma tela
  administrativa exposta na Etapa 1.
