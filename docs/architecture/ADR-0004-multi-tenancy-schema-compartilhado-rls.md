# ADR-0004 — Multi-tenancy por schema compartilhado + RLS

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

Cada empresa assinante opera em um workspace isolado. As alternativas usuais
sao: um banco por cliente, um schema Postgres por cliente, ou um schema
compartilhado com discriminador de tenant por linha. A plataforma preve muitos
tenants pequenos e medios, migrations frequentes durante todo o roadmap, e um
mesmo usuario podendo participar de mais de um workspace (operacao de
consultoria).

## Decisao

Schema compartilhado, com `workspace_id` em toda tabela de tenant e isolamento
por Row Level Security.

Regras que passam a valer para todas as etapas seguintes:

1. Toda tabela de tenant tem `workspace_id`, com indice.
2. Nenhuma tabela entra sem RLS habilitada e politica na mesma migration/PR.
3. Toda coluna usada em politica RLS e indexada. Campos JSONB filtraveis
   recebem indice GIN quando necessario.
4. A condicao de acesso e sempre a mesma: existe `workspace_members` com
   `status = 'active'` ligando `auth.uid()` aquele `workspace_id`.
5. A RLS **reforca** a autorizacao — nao a substitui. A aplicacao continua
   responsavel por autorizar a acao; a RLS e a rede de seguranca de ultimo
   nivel.

### Helpers em `SECURITY DEFINER`

As politicas chamam `app.is_workspace_member()` e `app.has_workspace_role()`,
funcoes `SECURITY DEFINER` com `search_path = ''`, no schema `app` (nao
exposto via PostgREST).

O motivo e concreto: a politica de `workspace_members` precisa consultar a
propria `workspace_members`, o que causaria recursao infinita de politica. Uma
funcao `SECURITY DEFINER` executa fora da RLS e corta o ciclo. Efeito colateral
positivo: o predicado fica em um lugar so, entao mudar a regra de acesso nao
significa editar N politicas espalhadas.

`FORCE ROW LEVEL SECURITY` esta ativo nas tres tabelas, para que nem o dono da
tabela escape das politicas.

## Consequencias

- Migration unica atinge todos os tenants — essencial num roadmap de nove
  etapas.
- O custo e vigilancia permanente: uma tabela criada sem politica vaza tudo.
  Por isso a regra 2 e condicao de merge, e por isso existe
  `supabase/tests/rls_isolation_test.sql`.
- Politica RLS entra no plano de toda query; sem os indices da regra 3 a
  degradacao aparece em producao, nao em desenvolvimento.
- Isolamento fisico por cliente (banco dedicado) fica indisponivel. Se algum
  contrato exigir, sera um novo ADR, nao um remendo.
