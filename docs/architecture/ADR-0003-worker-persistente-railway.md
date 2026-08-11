# ADR-0003 — Servico persistente na Railway (Render como alternativa)

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 1

## Contexto

WebSocket, recebimento de webhooks de canais, filas com retry/backoff e jobs
agendados exigem um processo que fica de pe. O modelo serverless da Vercel nao
serve para isso: nao mantem conexao aberta, nao guarda estado entre invocacoes
e tem teto de tempo de execucao.

## Decisao

`services/worker` como servico Node persistente na Railway, com Render como
alternativa compativel (mesmo start command, mesmo health check path — a
portabilidade e deliberada e nao custa nada).

Na Etapa 1 o servico entrega apenas `/health` e `/ready`, sem dependencias
externas e sem nenhuma dependencia npm. O objetivo agora e fixar o contrato de
deploy, ambiente e observabilidade antes que exista carga real.

## Consequencias

- Custo fixo de um servico rodando desde ja, antes de haver trafego. Aceito:
  descobrir problema de deploy na etapa de canais seria muito mais caro.
- Duas superficies de deploy (Vercel + Railway) e dois conjuntos de variaveis
  de ambiente para manter em sincronia.
- Escolha explicita de manter o worker sem dependencias enquanto for esqueleto:
  sobe em segundos e sobrevive a qualquer politica de rede restritiva.
