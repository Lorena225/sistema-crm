# ADR-0020 — Transporte real da Twilio e onboarding de canal

- **Status:** Aceito
- **Data:** 12/08/2026
- **Etapa:** 5 (continuacao — fechamento de lacunas)

## Contexto

A Etapa 5 entregou a fundacao do inbox com `transportes` como mapa injetado:
so os testes o preenchiam. O criterio de aceite 4 ficou **parcial**, e o PR
registrou isso. Esta continuacao fecha os dois buracos: transporte real e
onboarding de canal com diagnostico.

## Decisao

### O envio usa a credencial da SUBCONTA, nunca a da master

A master serve para uma coisa so: criar subcontas. Cada `channel_account` de
WhatsApp envia com o proprio Account SID e Auth Token, decifrados no momento
do envio. Um vazamento fica contido em um cliente, e a rotacao de um nao para
os outros.

O texto plano do token existe apenas dentro do processo, entre `decifrar()` e
o cabecalho HTTP. Nao vai para log, metrica nem mensagem de erro — inclusive
quando a credencial esta corrompida, caso em que a mensagem de erro e generica
de proposito, para nao repetir fragmento do material cifrado.

### Erro da Twilio traduzido, e classificado em dois tipos

Um mapa converte codigo em texto que o atendente entende. `63016` vira *"A
janela de 24 horas do WhatsApp expirou. Envie um template aprovado para
reabrir a conversa."*

Mais importante que a traducao e a classificacao: os codigos do mapa viram
`FalhaDefinitiva` e **nao sao retentados**; qualquer outro erro (429, 5xx,
rede) e transitorio e volta para a fila com backoff. Retentar um opt-out ou um
numero invalido so queima cota e reputacao do numero.

### O cockpit nao envia: ele pede

A tela grava a mensagem como `queued` e chama `/api/inbox/enviar`, que repassa
ao worker. Quem conhece janela, teto, retry e backoff continua sendo um lugar
so.

Consequencia deliberada: **se o worker estiver fora do ar, a mensagem fica
`queued` no banco em vez de se perder**. A tela avisa e segue. O caminho
alternativo seria enviar direto do Next.js, o que duplicaria as regras e
criaria duas verdades sobre o que ja foi enviado.

### Onboarding grava por rota server-side

`credentials` nao tem `GRANT` de escrita para `authenticated` (decisao da
Etapa 5). Entao a tela nao pode gravar nem que queira: `/api/canais/provisionar`
cria a subconta, cifra o token e grava com service role — **depois** de
confirmar, sob RLS, que quem chama e membro ativo do workspace. A service role
entra so na escrita, nunca na autorizacao.

Duas diferencas em relacao a rota administrativa da Etapa 2, ambas
intencionais:

- **A falha de auditoria nao derruba a resposta.** Ali, acesso sem trilha nao
  podia existir. Aqui, a subconta Twilio ja foi criada quando a trilha e
  escrita; devolver erro faria o operador tentar de novo e criar uma segunda
  subconta. Registra-se um aviso estruturado e segue.
- **A trilha guarda o SID da subconta**, que e identificador publico, e nunca
  o token.

### Cifragem duplicada entre web e worker

`apps/web/lib/crypto/credenciais.ts` repete o formato `v1:iv:tag:dados` do
worker. As duas pontas leem a mesma coluna: o onboarding grava, o worker
envia. Formato divergente falharia em producao e nao no teste.

A alternativa seria um pacote compartilhado no monorepo. Vale a pena quando
houver uma terceira ponta; com duas, a duplicacao de trinta linhas custa menos
que a infraestrutura de build.

## Consequencias

- O worker agora precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Sem
  elas ele **sobe assim mesmo**, com health check e fonte simulada, e reporta
  `canais_reais: ausentes` em `/ready`. Variavel faltando nao pode derrubar o
  servico inteiro.
- `TWILIO_MASTER_ACCOUNT_SID` e `TWILIO_MASTER_AUTH_TOKEN` no ambiente da
  Vercel (onboarding) e do Railway (envio).
- O repositorio do worker fala com o PostgREST por HTTP, sem SDK: a
  dependencia zero se mantem. Em compensacao, o filtro por `workspace_id` e
  responsabilidade de quem escreve a consulta — com service role, esquecer o
  filtro nao da erro, vaza.
- A validacao ponta a ponta com o Sandbox depende de credencial real e de
  deploy; ate la, os 11 testes de transporte usam `fetch` injetado.
