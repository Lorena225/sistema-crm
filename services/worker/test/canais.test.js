/**
 * Testes dos canais (Etapa 5). Runner nativo do Node, sem dependencia.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { criarFila } from '../src/lib/queue.js';
import { normalizar, normalizadores } from '../src/canais/normalizador.js';
import {
  verificarJanelaWhatsApp, criarControleDeTaxa, provisionarSubconta, TETO_POR_CANAL,
} from '../src/canais/twilio.js';
import {
  registrarFilaDeSaida, criarRepositorioMemoria, FalhaDefinitiva,
} from '../src/canais/fila-saida.js';
import { decifrar } from '../src/lib/crypto.js';

const CHAVE = Buffer.alloc(32, 9).toString('base64');

test('normalizacao: Twilio, Meta e Telegram viram a mesma forma', () => {
  const wa = normalizar('twilio', {
    MessageSid: 'SM1', From: 'whatsapp:+5561999990000', Body: 'Oi', NumMedia: '0',
  });
  assert.equal(wa.canal, 'whatsapp');
  assert.equal(wa.external_message_id, 'SM1');
  assert.equal(wa.remetente_externo, '+5561999990000');
  assert.equal(wa.media_type, 'text');

  const sms = normalizar('twilio', { MessageSid: 'SM2', From: '+5561999990000', Body: 'Oi' });
  assert.equal(sms.canal, 'sms', 'sem prefixo whatsapp: e SMS');

  const ig = normalizar('meta', {
    object: 'instagram',
    entry: [{ messaging: [{ sender: { id: 'u1' }, message: { mid: 'm1', text: 'Ola' } }] }],
  });
  assert.equal(ig.canal, 'instagram');
  assert.equal(ig.content, 'Ola');

  const tg = normalizar('telegram', {
    message: { message_id: 7, chat: { id: 42 }, voice: { file_id: 'f1', duration: 12 } },
  });
  assert.equal(tg.media_type, 'audio');
  assert.equal(tg.duration_seconds, 12);

  // Todos expõem as mesmas chaves canonicas.
  for (const n of [wa, sms, ig, tg]) {
    assert.ok('external_message_id' in n && 'media_type' in n && 'direction' in n);
    assert.equal(n.direction, 'inbound');
  }
});

test('normalizacao: audio do Twilio vira media_type audio', () => {
  const n = normalizar('twilio', {
    MessageSid: 'SM3', From: 'whatsapp:+55619', NumMedia: '1',
    MediaUrl0: 'https://x/a.ogg', MediaContentType0: 'audio/ogg',
  });
  assert.equal(n.media_type, 'audio');
  assert.equal(n.media_url, 'https://x/a.ogg');
});

test('normalizacao: evento sem id externo e descartado', () => {
  assert.equal(normalizar('twilio', { From: '+55619', Body: 'sem sid' }), null);
  assert.equal(normalizar('inexistente', {}), null);
  assert.equal(normalizadores.meta({ entry: [{}] }), null);
});

test('janela do WhatsApp: dentro, fora e template', () => {
  const agora = new Date().toISOString();
  const ontem = new Date(Date.now() - 25 * 3600_000).toISOString();

  assert.equal(verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm: agora }).permitido, true);

  const fora = verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm: ontem });
  assert.equal(fora.permitido, false);
  assert.match(fora.motivo, /24 horas/, 'o motivo precisa ser legivel para o atendente');
  assert.match(fora.motivo, /template aprovado/, 'e precisa dizer o que fazer');

  assert.equal(
    verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm: ontem, ehTemplate: true }).permitido,
    true, 'template reabre a conversa'
  );

  const nunca = verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm: null });
  assert.equal(nunca.permitido, false);
});

test('limite do Instagram: 200 automaticas por hora, por conta', () => {
  let relogio = Date.now();
  const controle = criarControleDeTaxa({ agora: () => relogio });

  for (let i = 0; i < TETO_POR_CANAL.instagram; i += 1) {
    assert.equal(
      controle.permitir({ channelAccountId: 'conta-a', canal: 'instagram' }).permitido, true,
      `mensagem ${i + 1} deveria passar`
    );
  }

  const excedente = controle.permitir({ channelAccountId: 'conta-a', canal: 'instagram' });
  assert.equal(excedente.permitido, false);
  assert.match(excedente.motivo, /200 mensagens automaticas por hora/);

  // O teto e POR CONTA: outra conta do mesmo workspace segue livre.
  assert.equal(
    controle.permitir({ channelAccountId: 'conta-b', canal: 'instagram' }).permitido, true,
    'uma conta no limite nao pode calar as outras'
  );

  // Mensagem humana nao entra no teto.
  assert.equal(
    controle.permitir({ channelAccountId: 'conta-a', canal: 'instagram', ehAutomatica: false }).permitido,
    true, 'o limite existe para disparo automatico, nao para o atendente'
  );

  // Passada a hora, a janela reinicia.
  relogio += 3_600_001;
  assert.equal(controle.permitir({ channelAccountId: 'conta-a', canal: 'instagram' }).permitido, true);
});

test('limite: canal sem teto definido nao e limitado', () => {
  const controle = criarControleDeTaxa();
  for (let i = 0; i < 500; i += 1) {
    assert.equal(controle.permitir({ channelAccountId: 'c', canal: 'whatsapp' }).permitido, true);
  }
});

test('fila de saida: falha em uma mensagem nao bloqueia as demais', async () => {
  const fila = criarFila({ tentativasMaximas: 3, atrasoBaseMs: 5 });
  const repositorio = criarRepositorioMemoria();
  const enviadas = [];

  const transportes = {
    whatsapp: async ({ destino }) => {
      if (destino === '+quebra') throw new Error('provedor indisponivel');
      enviadas.push(destino);
      return { idExterno: `ext_${destino}` };
    },
  };

  const saida = registrarFilaDeSaida({
    fila, controleDeTaxa: criarControleDeTaxa(), repositorio, transportes,
  });

  const agora = new Date().toISOString();
  saida.enfileirar({ mensagemId: 'm1', canal: 'whatsapp', destino: '+1', ultimaMensagemDoContatoEm: agora });
  saida.enfileirar({ mensagemId: 'm2', canal: 'whatsapp', destino: '+quebra', ultimaMensagemDoContatoEm: agora });
  saida.enfileirar({ mensagemId: 'm3', canal: 'whatsapp', destino: '+3', ultimaMensagemDoContatoEm: agora });

  fila.bombear();
  await fila.drenar();

  assert.deepEqual(enviadas.sort(), ['+1', '+3'], 'as saudaveis precisam sair');
  assert.equal((await repositorio.obter('m1')).delivery_status, 'sent');
  assert.equal((await repositorio.obter('m3')).delivery_status, 'sent');
  assert.equal(fila.cartaMorta.length, 1, 'a que falhou vai para a carta morta');
});

test('fila de saida: janela expirada falha em definitivo, sem retentar', async () => {
  const fila = criarFila({ tentativasMaximas: 5, atrasoBaseMs: 5 });
  const repositorio = criarRepositorioMemoria();
  let tentativasDeEnvio = 0;

  const saida = registrarFilaDeSaida({
    fila,
    controleDeTaxa: criarControleDeTaxa(),
    repositorio,
    transportes: { whatsapp: async () => { tentativasDeEnvio += 1; return {}; } },
  });

  saida.enfileirar({
    mensagemId: 'm9', canal: 'whatsapp', destino: '+5',
    ultimaMensagemDoContatoEm: new Date(Date.now() - 30 * 3600_000).toISOString(),
  });

  fila.bombear();
  await fila.drenar();

  const gravada = await repositorio.obter('m9');
  assert.equal(gravada.delivery_status, 'failed');
  assert.match(gravada.error_reason, /janela de 24 horas/i);
  assert.equal(tentativasDeEnvio, 0, 'nem chegou a tentar o transporte');
  assert.equal(fila.cartaMorta.length, 0, 'falha definitiva nao vira carta morta');
});

test('fila de saida: limite de conta tambem falha em definitivo', async () => {
  const fila = criarFila({ tentativasMaximas: 3, atrasoBaseMs: 5 });
  const repositorio = criarRepositorioMemoria();
  const controle = criarControleDeTaxa();

  for (let i = 0; i < TETO_POR_CANAL.instagram; i += 1) {
    controle.permitir({ channelAccountId: 'ig-1', canal: 'instagram' });
  }

  const saida = registrarFilaDeSaida({
    fila, controleDeTaxa: controle, repositorio,
    transportes: { instagram: async () => ({}) },
  });

  saida.enfileirar({ mensagemId: 'm10', canal: 'instagram', channelAccountId: 'ig-1', destino: 'u1' });
  fila.bombear();
  await fila.drenar();

  const gravada = await repositorio.obter('m10');
  assert.equal(gravada.delivery_status, 'failed');
  assert.match(gravada.error_reason, /Limite de 200/);
});

test('subconta Twilio: credenciais voltam cifradas e o token nao vaza', async () => {
  process.env.TWILIO_MASTER_ACCOUNT_SID = 'ACmaster';
  process.env.TWILIO_MASTER_AUTH_TOKEN = 'token-master';
  process.env.ENCRYPTION_KEY = CHAVE;

  let urlChamada = null;
  let metodo = null;
  let autorizacao = null;

  const fetchFalso = async (url, opcoes) => {
    urlChamada = url; metodo = opcoes.method; autorizacao = opcoes.headers.Authorization;
    return {
      ok: true,
      json: async () => ({ sid: 'ACsub123', auth_token: 'token-da-subconta', status: 'active' }),
    };
  };

  const r = await provisionarSubconta({ nomeAmigavel: 'Cliente X', fetchImpl: fetchFalso });

  assert.equal(urlChamada, 'https://api.twilio.com/2010-04-01/Accounts.json');
  assert.equal(metodo, 'POST');
  assert.ok(autorizacao.startsWith('Basic '), 'autentica com SID e token, nunca login de painel');

  assert.equal(r.accountSid, 'ACsub123');
  assert.ok(r.credentialsCifradas.startsWith('v1:'), 'precisa sair no formato cifrado');
  assert.ok(!r.credentialsCifradas.includes('token-da-subconta'), 'o token nao pode aparecer em claro');

  const decifrado = JSON.parse(decifrar(r.credentialsCifradas, CHAVE));
  assert.equal(decifrado.auth_token, 'token-da-subconta');
  assert.equal(decifrado.account_sid, 'ACsub123');
});

test('subconta Twilio: sem credencial master, falha com mensagem clara', async () => {
  delete process.env.TWILIO_MASTER_ACCOUNT_SID;
  delete process.env.TWILIO_MASTER_AUTH_TOKEN;
  await assert.rejects(
    () => provisionarSubconta({ nomeAmigavel: 'X', fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }),
    /TWILIO_MASTER_ACCOUNT_SID/
  );
});

test('FalhaDefinitiva carrega a marca que impede o retry', () => {
  const e = new FalhaDefinitiva('motivo');
  assert.equal(e.definitiva, true);
});
