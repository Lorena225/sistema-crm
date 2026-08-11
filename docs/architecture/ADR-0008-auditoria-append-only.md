# ADR-0008 — Auditoria append-only imposta pelo banco

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 2

## Contexto

`audit_log_entries` e a resposta a uma falha concreta do produto que estamos
substituindo: relatos de perda de dado sem rastro e permissoes que ninguem
consegue reconstruir depois do fato. Uma trilha que pode ser editada nao
responde a pergunta que se faz num incidente — "quem mudou isso, e quando?" —
porque a propria resposta pode ter sido alterada.

## Decisao

### O bloqueio vive no banco, nao na aplicacao

RLS sozinha nao basta: `service_role` tem `BYPASSRLS`, e toda rota
administrativa usa service role. Por isso a garantia e um gatilho
`BEFORE UPDATE OR DELETE` que levanta excecao para **qualquer** papel,
inclusive o dono da tabela. Nao existe caminho de aplicacao que o contorne;
para desligar seria preciso uma migration explicita, revisada em PR.

### Um unico instrumento de escrita

`app.record_audit(...)`, `SECURITY DEFINER`, concedida apenas a
`service_role`. `authenticated` nao recebe `EXECUTE`: usuario final nao
escreve na propria trilha, nem para "corrigir" um registro. Os gatilhos de
`workspaces`, `workspace_members` e `reseller_admins` chamam a mesma funcao,
entao existe um so lugar onde o formato da entrada pode mudar.

### Sem FK para `workspaces`

`workspace_id` nao tem chave estrangeira, e isso e proposital. Com
`ON DELETE CASCADE`, apagar um tenant apagaria junto a trilha do que foi
feito nele — exatamente o momento em que a trilha mais importa. Com
`ON DELETE RESTRICT`, nenhum tenant poderia ser removido. A trilha precisa
sobreviver ao tenant, entao ela guarda o identificador sem depender da linha.

### Esquema generico desde ja

`resource_type` + `resource_id` + `before_state`/`after_state` em jsonb, em
vez de uma coluna por entidade. Todos os modulos futuros (negocios, conversas,
automacoes, agentes) escrevem aqui sem migration nova. O custo e nao ter
integridade referencial sobre `resource_id`; o beneficio e nao reabrir a
tabela de auditoria a cada etapa.

### Ator inferido, com escape

`app.current_actor_type()` classifica: sem `auth.uid()` e `system`; se o
usuario consta em `reseller_admins` e `reseller_admin`; caso contrario e
`user`. `ai_agent` e `automation` serao informados explicitamente pelos
modulos que os introduzem — inferir isso agora seria adivinhar.

## Consequencias

- Correcao de entrada errada e impossivel por design. O procedimento correto
  passa a ser gravar uma entrada nova que descreva a correcao.
- A tabela cresce sem limite. Retencao e particionamento sao decisao de uma
  etapa futura de operacao, com dado real de volume — nao agora, no chute.
- `before_state`/`after_state` guardam a linha inteira em jsonb. Se alguma
  tabela futura tiver coluna sensivel, o gatilho dela precisa filtrar antes de
  gravar. Registrado aqui para nao ser esquecido.
- Sem indice GIN nos jsonb nesta etapa: sao payload de leitura, nao criterio
  de filtro. Entra quando existir consulta que filtre por dentro deles.
