# ADR-0007 — Criacao de workspace via RPC SECURITY DEFINER

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

Ha um problema de ovo e galinha na criacao de tenant: a politica de acesso a
`workspaces` exige associacao ativa em `workspace_members`, mas quem cria o
workspace ainda nao e membro no instante do INSERT. Uma politica de INSERT
permissiva em `workspaces` resolveria — ao custo de permitir que qualquer
usuario autenticado crie workspaces orfaos, sem owner, direto pela API REST.

## Decisao

`public.workspaces` **nao tem politica de INSERT**. A criacao ocorre apenas
por `public.create_workspace(p_name, p_slug)`, funcao `SECURITY DEFINER` que:

1. rejeita chamada sem `auth.uid()`;
2. insere o workspace;
3. insere o autor como `owner` ativo — na mesma transacao.

Nao existe estado intermediario de workspace sem dono.

## Consequencias

- O linter do Supabase reporta
  `authenticated_security_definer_function_executable` para essa funcao. E
  intencional: e o unico caminho de criacao de tenant, e ela valida a
  identidade do chamador antes de escrever.
- Toda regra futura de criacao de workspace (limite por plano, convite,
  provisionamento pelo reseller) tem um unico lugar para entrar.
- `DELETE` em `workspaces` tambem nao tem politica: remocao de tenant e
  operacao administrativa server-side, nao acao de usuario final.
