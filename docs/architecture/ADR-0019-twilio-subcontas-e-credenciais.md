# ADR-0019 — Subconta Twilio por conta de canal, credencial sempre cifrada

- **Status:** Aceito
- **Data:** 12/08/2026
- **Etapa:** 5

## Contexto

A VirtruvIA opera como BSP: a WABA fica no Business Manager do cliente final,
e a plataforma intermedia o envio. Isso exige guardar credencial de terceiros
— o material mais sensivel que o sistema vai tocar.

## Decisao

### Uma subconta por `channel_account` de WhatsApp

Ao provisionar, o worker chama `POST /2010-04-01/Accounts.json` com a conta
master e grava o Account SID e o Auth Token da **subconta** em
`channel_accounts.credentials`, cifrados.

Subconta em vez de master compartilhada por tres motivos: faturamento
separado, limites separados e incidente separado. Um cliente com problema de
qualidade nao arrasta os outros.

### Somente SID e Auth Token — nunca login de painel

O escopo proibe explicitamente pedir, aceitar ou armazenar e-mail e senha do
Console Twilio. A razao e concreta: login de painel e credencial de pessoa, da
acesso a tudo e nao pode ser revogado por escopo. SID e token sao credencial
de maquina, rotacionaveis e limitados a subconta.

### Tres barreiras contra credencial em texto plano

1. **Cifragem obrigatoria** — `cifrar()` (AES-256-GCM, Etapa 2) antes de
   qualquer gravacao. O texto plano do token existe apenas dentro de
   `provisionarSubconta` e nao e retornado.
2. **Restricao no banco** — `channel_accounts_credenciais_cifradas` exige o
   prefixo `v1:`. Gravar credencial crua pelo painel do Supabase e recusado
   pelo Postgres. Esta e a barreira que protege contra o erro humano mais
   provavel da etapa.
3. **`GRANT` por coluna** — `authenticated` recebe `SELECT` nas colunas de
   `channel_accounts` **exceto** `credentials`. Mesmo com sessao valida e
   consulta direta a API REST, a coluna nao vem.

O log registra apenas o Account SID, que e identificador publico. O token
nunca aparece — nem em log, nem em metrica, nem em mensagem de erro (o corpo
de erro da Twilio e truncado por precaucao).

## Consequencias

- `TWILIO_MASTER_ACCOUNT_SID` e `TWILIO_MASTER_AUTH_TOKEN` sao obrigatorios no
  ambiente do worker. A funcao falha com mensagem clara se faltarem, em vez de
  quebrar no meio do provisionamento.
- Testes usam o Sandbox do WhatsApp: a WABA real por cliente so entra pelo
  onboarding guiado, depois do CRM pronto.
- Rotacao de token de subconta ainda nao tem procedimento. Precisa entrar
  antes do primeiro cliente real em producao.
- A restricao de formato valida o prefixo, nao a cifragem em si. Alguem
  determinado poderia gravar `v1:` seguido de lixo. E uma trava contra
  descuido, nao contra ma-fe de quem ja tem acesso de escrita.
