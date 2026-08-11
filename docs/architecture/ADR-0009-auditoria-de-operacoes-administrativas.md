# ADR-0009 — Operacao administrativa so existe se ficar registrada

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 2

## Contexto

O acesso `reseller_admin` atravessa o isolamento de tenant: e o unico caminho
capaz de ler dados de todos os clientes. A Etapa 1 deixou esse caminho
fechado ao client-side, mas ainda sem trilha. Acesso poderoso e nao auditado e
o pior dos dois mundos — poder sem prestacao de contas.

## Decisao

`public.log_admin_action(...)` e o ponto de entrada de auditoria das rotas
administrativas. Detalhes que carregam intencao:

1. **Existe em `public` porque precisa.** `app.record_audit` vive no schema
   `app`, que nao e exposto via PostgREST — de proposito. As rotas do Next.js
   falam com o banco por PostgREST, entao precisam de um wrapper em `public`.
   Ele e concedido **apenas a `service_role`**, e delega para
   `app.record_audit`: continua havendo um unico caminho de gravacao.
2. **`actor_id` e obrigatorio.** A funcao levanta excecao se vier nulo.
   Entrada administrativa sem dono nao e auditoria, e ruido.
3. **`actor_type` e fixado como `reseller_admin`.** Quem chama nao escolhe
   como quer aparecer na trilha.
4. **A rota falha se a trilha falhar.** Em `GET /api/admin/workspaces`, o
   registro acontece antes de a resposta sair; erro ao gravar devolve 500 e
   nenhum dado. O acesso e permitido *porque* fica registrado — logo, registrar
   nao pode ser um efeito colateral que se perde em silencio.

## Consequencias

- Indisponibilidade da auditoria derruba o acesso administrativo. E o
  comportamento desejado: preferimos o suporte esperando a um acesso
  cross-tenant sem rastro.
- Toda nova rota administrativa precisa chamar `log_admin_action`. Isso e
  disciplina de revisao de PR, nao garantia automatica — a alternativa
  (interceptar tudo em middleware) fica para quando existirem varias rotas.
- A listagem administrativa nao pertence a nenhum tenant, entao grava com
  workspace nulo (`00000000-...`). Consultas de trilha por workspace
  naturalmente nao a incluem; e uma entrada de plataforma, nao de cliente.
