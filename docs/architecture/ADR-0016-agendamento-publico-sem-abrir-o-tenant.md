# ADR-0016 — Agendamento publico sem abrir o tenant

- **Status:** Aceito
- **Data:** 11/08/2026
- **Etapa:** 4

## Contexto

A pagina publica de agendamento e a primeira superficie do produto acessivel
por alguem **sem sessao**. Quem entra em `/agendar/<slug>` precisa ler os
horarios disponiveis e gravar uma reserva — duas operacoes que, feitas do jeito
obvio, exigiriam conceder `select` e `insert` ao papel `anon` em
`booking_pages`, `booking_slots`, `contacts`, `deals` e `tasks`.

Isso seria abrir cinco tabelas de tenant para a internet inteira. Uma politica
mal escrita ali vaza a base de contatos de todos os workspaces.

## Decisao

O papel `anon` **nao recebe grant em nenhuma tabela**. Toda a operacao passa
por duas funcoes `SECURITY DEFINER` com escopo estreito:

| Funcao | O que devolve / faz |
|---|---|
| `public.get_public_booking_page(slug)` | titulo, duracao, buffer e as janelas disponiveis daquela pagina — nada mais |
| `public.create_public_booking(...)` | valida e cria contato, negocio (opcional) e tarefa em uma transacao |

A superficie exposta e exatamente o necessario para agendar. Nao ha parametro
que permita ler outro workspace, listar contatos ou consultar tarefas: a
funcao de leitura devolve colunas fixas de uma unica pagina.

### O que `create_public_booking` valida antes de gravar

1. A pagina existe (busca por slug).
2. A data nao esta no passado.
3. A janela solicitada **cabe inteira** em um slot disponivel — comparando na
   hora local de Sao Paulo, nao em UTC, senao a janela "09h as 12h" mudaria de
   posicao conforme o fuso de quem agenda.
4. O buffer e respeitado dos dois lados: nenhuma outra reserva daquela pagina
   pode encostar na janela somando o intervalo configurado. Sem isso, duas
   reunioes de 30 minutos com 15 de intervalo poderiam ser marcadas com 20
   minutos de diferenca.
5. O contato e reaproveitado por e-mail antes de criar um novo — a mesma
   pessoa agendando tres vezes nao vira tres cadastros.

### Slug unico globalmente

`booking_pages.slug` tem indice unico **global**, e nao por workspace. A URL
publica nao carrega o tenant, entao dois workspaces com a pagina `reuniao`
tornariam o link ambiguo. O preco e que o primeiro a registrar um slug o
reserva para toda a plataforma.

## Consequencias

- A rota `/agendar` e publica no middleware. E a unica excecao alem de
  `/login`, `/auth` e `/offline`.
- Nao ha rate limit. Alguem pode encher a agenda com reservas falsas. A defesa
  natural — captcha ou confirmacao por e-mail — depende de canais, que sao da
  Etapa 5. Registrado como limitacao consciente.
- O fuso esta fixo em `America/Sao_Paulo`. Correto para a operacao brasileira
  de hoje; um cliente com equipe em outro fuso exigira a coluna de fuso na
  pagina de agendamento.
- Toda reserva nasce com `source = 'agendamento_publico'`, o que permite
  separar depois o que veio de fora do que a equipe criou.
