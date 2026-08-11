# ADR-0012 — Fila offline local sem relaxar o isolamento

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 2

## Contexto

O operador de campo perde sinal, registra o que aconteceu na visita e so
reencontra rede depois. Se a acao depender de conexao no instante do toque,
ela se perde — e o que se perde e justamente o dado que ninguem vai voltar
para digitar.

O risco oposto e igualmente real: suporte offline mal feito vira cache de
dado de tenant no disco do aparelho, fora do alcance da RLS.

## Decisao

### IndexedDB, nao localStorage

Sobrevive a fechar o navegador, guarda objeto estruturado sem serializar na
mao e nao bloqueia a thread principal. `localStorage` falharia nos tres
pontos.

### Operacoes tipadas e adiadas

A fila guarda a **intencao** (`nota.criar` com seu payload), nao uma chamada
HTTP montada. Assim a Etapa 4 (tarefas) e a Etapa 5 (notas) podem mudar o
destino sem invalidar o que ja esta na fila do aparelho de alguem. Uma fila
que guarda requisicoes prontas envelhece junto com a API.

### A sincronizacao revalida autorizacao

`POST /api/offline/sync` consulta `workspace_members` **com o cliente sob
RLS**, nao com service role. Uma operacao registrada as 9h por alguem removido
do workspace as 10h e recusada as 11h com 403.

Isso responde diretamente ao "nao relaxar RLS para viabilizar sincronizacao":
a fila local guarda intencao, nao permissao. A permissao e verificada no
momento da reconciliacao, pela mesma politica que vale para qualquer outra
leitura.

### O service worker nao guarda API em cache

`/api/*` e `/auth/*` sao explicitamente ignorados. Guardar resposta de API
significaria servir dado de tenant a partir do disco do aparelho, inclusive
depois de a pessoa perder acesso ao workspace. O cache guarda somente o casco
da aplicacao, para que ela abra sem rede e a fila funcione.

`/offline` e rota publica no middleware — verificar sessao exige rede, e essa
e a pagina que precisa abrir justamente quando nao ha.

## Consequencias

- Operacao aceita nesta etapa **nao e persistida**: `tasks` e `notes`
  pertencem as Etapas 4 e 5. A rota devolve `persistida: false`. Criar aqui uma
  tabela improvisada para "guardar enquanto isso" seria schema inventado.
- Operacao recusada por autorizacao fica na fila com status `falhou` e o
  motivo. Nao e descartada em silencio: quem registrou merece saber que o
  trabalho nao subiu.
- Os icones do manifesto sao marcadores gerados na cor da marca. Substituir
  pelo icone definitivo da VirtruvIA antes de divulgar a instalacao.
- A tela `/offline` e instrumento de verificacao, nao a tela definitiva de
  notas.
