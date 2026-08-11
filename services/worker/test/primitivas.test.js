/**
 * Testes das primitivas transversais da Etapa 2.
 * Roda com o runner nativo do Node: `npm test --workspace @kommopp/worker`.
 * Sem dependencia externa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { criarFila, calcularAtraso } from '../src/lib/queue.js';
import { criarIdempotencia } from '../src/lib/idempotency.js';
import { criarReceptorWebhook } from '../src/lib/webhooks.js';
import { cifrar, decifrar, assinar, verificarAssinatura } from '../src/lib/crypto.js';
import { _internos } from '../src/lib/logger.js';
import { limpar as limparMetricas, instantaneo } from '../src/lib/metrics.js';
import {
  registrarFontesSimuladas,
  efeitoExterno,
  limparSimulacao,
} from '../src/simulacao/webhook-simulado.js';

const CHAVE_TESTE = Buffer.alloc(32, 7).toString('base64');

test('fila: job que falha e reprocessado ate ter sucesso', async () => {
  const fila = criarFila({ tentativasMaximas: 5, atrasoBaseMs: 5 });
  let tentativas = 0;

  fila.registrar('teste', async () => {
    tentativas += 1;
    if (tentativas < 3) throw new Error('falha proposital');
    return 'ok';
  });

  fila.enfileirar('teste', {});
  fila.bombear();
  await fila.drenar();

  assert.equal(tentativas, 3, 'deveria ter tentado tres vezes');
  assert.equal(fila.cartaMorta.length, 0, 'nao deveria ter ido para a carta morta');
});

test('fila: falha isolada — um job quebrado nao impede os demais', async () => {
  const fila = criarFila({ tentativasMaximas: 2, atrasoBaseMs: 5 });
  const concluidos = [];

  fila.registrar('quebrado', async () => {
    throw new Error('sempre falha');
  });
  fila.registrar('saudavel', async (p) => {
    concluidos.push(p.n);
  });

  fila.enfileirar('quebrado', {});
  fila.enfileirar('saudavel', { n: 1 });
  fila.enfileirar('saudavel', { n: 2 });
  fila.bombear();
  await fila.drenar();

  assert.deepEqual(concluidos.sort(), [1, 2], 'os jobs saudaveis deveriam concluir');
  assert.equal(fila.cartaMorta.length, 1, 'o job quebrado vai para a carta morta');
  assert.equal(fila.cartaMorta[0].motivo, 'tentativas_esgotadas');
});

test('fila: backoff cresce e respeita o teto', () => {
  const cfg = { atrasoBaseMs: 100, atrasoMaximoMs: 1000 };
  const a1 = calcularAtraso(1, cfg);
  const a3 = calcularAtraso(3, cfg);

  assert.ok(a1 >= 90 && a1 <= 120, `primeira tentativa fora da faixa: ${a1}`);
  assert.ok(a3 > a1, 'o atraso deveria crescer entre tentativas');
  assert.ok(calcularAtraso(20, cfg) <= 1200, 'o teto deveria limitar o crescimento');
});

test('idempotencia: a mesma chave executa uma vez so', async () => {
  const idem = criarIdempotencia();
  let execucoes = 0;

  const fn = async () => {
    execucoes += 1;
    return 'efeito';
  };

  const primeira = await idem.executarUmaVez('k1', fn);
  const segunda = await idem.executarUmaVez('k1', fn);

  assert.equal(execucoes, 1, 'a funcao deveria rodar uma unica vez');
  assert.equal(primeira.deduplicado, false);
  assert.equal(segunda.deduplicado, true);
  assert.equal(segunda.resultado, 'efeito', 'a segunda chamada devolve o resultado guardado');
});

test('idempotencia: falha libera a chave para reprocessamento', async () => {
  const idem = criarIdempotencia();
  let execucoes = 0;

  await assert.rejects(
    idem.executarUmaVez('k2', async () => {
      execucoes += 1;
      throw new Error('falhou');
    })
  );

  const depois = await idem.executarUmaVez('k2', async () => {
    execucoes += 1;
    return 'ok';
  });

  assert.equal(execucoes, 2, 'apos falha, a chave precisa poder ser reprocessada');
  assert.equal(depois.deduplicado, false);
});

test('webhook simulado: falha, reprocessa e nao duplica o efeito externo', async () => {
  limparSimulacao();
  limparMetricas();

  const fila = criarFila({ tentativasMaximas: 5, atrasoBaseMs: 5 });
  const idempotencia = criarIdempotencia();
  const receptor = criarReceptorWebhook({ fila, idempotencia });
  registrarFontesSimuladas({ fila, idempotencia, receptor });

  const evento = JSON.stringify({ event_id: 'evt_001', falhas_ate: 2, dado: 'x' });

  // Primeira entrega: falha duas vezes antes de aplicar o efeito.
  const r1 = await receptor.receber({ fonte: 'simulado', corpoBruto: evento });
  assert.equal(r1.status, 202, 'o webhook deveria ser aceito');
  await fila.drenar();

  // Reentrega do mesmo evento, como faria um provedor real.
  const r2 = await receptor.receber({ fonte: 'simulado', corpoBruto: evento });
  assert.equal(r2.corpo.status, 'deduplicado', 'a reentrega deveria ser reconhecida');
  await fila.drenar();

  const efeito = efeitoExterno.instantaneo();
  assert.equal(efeito.total_chaves, 1, 'um unico efeito registrado');
  assert.equal(efeito.total_aplicacoes, 1, 'o efeito externo nao pode ser aplicado duas vezes');
  assert.equal(efeito.duplicadas, 0);
  assert.equal(fila.cartaMorta.length, 0, 'nao deveria ter sobrado job na carta morta');

  const metricas = instantaneo();
  assert.ok(
    Object.keys(metricas.contadores).some((k) => k.startsWith('worker_webhook_total')),
    'as metricas de webhook deveriam ter sido registradas'
  );
});

test('webhook: evento sem id de deduplicacao e recusado', async () => {
  const fila = criarFila();
  const idempotencia = criarIdempotencia();
  const receptor = criarReceptorWebhook({ fila, idempotencia });
  registrarFontesSimuladas({ fila, idempotencia, receptor });

  const r = await receptor.receber({ fonte: 'simulado', corpoBruto: JSON.stringify({ sem: 'id' }) });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'sem_id_evento');
});

test('webhook: assinatura invalida nao chega a ser enfileirada', async () => {
  const fila = criarFila();
  const idempotencia = criarIdempotencia();
  const receptor = criarReceptorWebhook({ fila, idempotencia });

  receptor.registrarFonte('assinada', { segredo: 'segredo-de-teste', tipoJob: 'x' });
  fila.registrar('x', async () => 'nao deveria rodar');

  const corpo = JSON.stringify({ id: 'evt_x' });
  const ruim = await receptor.receber({ fonte: 'assinada', corpoBruto: corpo, assinatura: 'errada' });
  assert.equal(ruim.status, 401);
  assert.equal(fila.estado.pendentes, 0, 'payload nao autenticado nao entra na fila');

  const boa = await receptor.receber({
    fonte: 'assinada',
    corpoBruto: corpo,
    assinatura: assinar(corpo, 'segredo-de-teste'),
  });
  assert.equal(boa.status, 202);
});

test('criptografia: ida e volta, e adulteracao e detectada', () => {
  const segredo = 'token-de-canal-super-secreto';
  const cifrado = cifrar(segredo, CHAVE_TESTE);

  assert.ok(cifrado.startsWith('v1:'), 'deveria carregar prefixo de versao');
  assert.ok(!cifrado.includes(segredo), 'o texto plano nao pode aparecer no valor guardado');
  assert.equal(decifrar(cifrado, CHAVE_TESTE), segredo);

  const partes = cifrado.split(':');
  partes[3] = Buffer.from('adulterado').toString('base64url');
  assert.throws(() => decifrar(partes.join(':'), CHAVE_TESTE), 'GCM deveria detectar adulteracao');
});

test('criptografia: chave invalida e recusada', () => {
  assert.throws(() => cifrar('x', 'curta-demais'));
  assert.throws(() => cifrar('x', undefined));
});

test('assinatura: verificacao aceita a correta e recusa a errada', () => {
  const corpo = '{"a":1}';
  assert.equal(verificarAssinatura(corpo, assinar(corpo, 's'), 's'), true);
  assert.equal(verificarAssinatura(corpo, assinar(corpo, 'outro'), 's'), false);
  assert.equal(verificarAssinatura(corpo, 'tamanho-diferente', 's'), false);
});

test('log: credenciais sao redigidas em qualquer profundidade', () => {
  const limpo = _internos.redigir({
    workspace_id: 'ws_1',
    integracao: {
      api_key: 'chave-real',
      config: { authorization: 'Bearer abc', timeout: 30 },
    },
    lista: [{ accessToken: 'tok' }],
  });

  assert.equal(limpo.workspace_id, 'ws_1', 'campo comum deve permanecer');
  assert.equal(limpo.integracao.api_key, '[redigido]');
  assert.equal(limpo.integracao.config.authorization, '[redigido]');
  assert.equal(limpo.integracao.config.timeout, 30);
  assert.equal(limpo.lista[0].accessToken, '[redigido]');
});

test('log: referencia circular nao derruba o processo', () => {
  const obj = { nome: 'x' };
  obj.self = obj;
  assert.equal(_internos.redigir(obj).self, '[circular]');
});
