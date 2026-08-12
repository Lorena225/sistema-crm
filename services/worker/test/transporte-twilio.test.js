/**
 * Testes do transporte real da Twilio (continuacao da Etapa 5).
 * Sem rede: `fetchImpl` e injetado.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { criarFila } from '../src/lib/queue.js';
import { criarControleDeTaxa } from '../src/canais/twilio.js';
import {
  registrarFilaDeSaida, criarRepositorioMemoria,
} from '../src/canais/fila-saida.js';
import {
  criarTransporteTwilio, criarResolvedorDeCredenciais, _internos,
} from '../src/canais/transporte-twilio.js';
import { cifrar } from '../src/lib/crypto.js';

const CHAVE = Buffer.alloc(32, 3).toString('base64');
process.env.ENCRYPTION_KEY = CHAVE;

const CREDENCIAIS = async () => ({
  accountSid: 'ACsub', authToken: 'token-sub', from: '+14155238886',
});

function respostaOk(corpo) {
  return { ok: true, json: async () => corpo };
}
function respostaErro(status, corpo) {
  return { ok: false, status, json: async () => corpo };
}

test('envio real: monta a chamada da Twilio corretamente', async () => {
  let url = null; let corpo = null; let auth = null;

  const enviar = criarTransporteTwilio({
    canal: 'whatsapp',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async (u, o) => {
      url = u; corpo = new URLSearchParams(o.body); auth = o.headers.Authorization;
      return respostaOk({ sid: 'SM999', status: 'queued' });
    },
  });

  const r = await enviar({ destino: '+5561999990000', conteudo: 'Ola', channelAccountId: 'c1' });

  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/ACsub/Messages.json');
  assert.equal(corpo.get('From'), 'whatsapp:+14155238886', 'WhatsApp exige o prefixo');
  assert.equal(corpo.get('To'), 'whatsapp:+5561999990000');
  assert.equal(corpo.get('Body'), 'Ola');
  assert.ok(auth.startsWith('Basic '), 'autentica por SID e token, nunca por login');
  assert.equal(r.idExterno, 'SM999');
});

test('envio real: SMS nao leva prefixo de WhatsApp', async () => {
  let corpo = null;
  const enviar = criarTransporteTwilio({
    canal: 'sms',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async (_u, o) => { corpo = new URLSearchParams(o.body); return respostaOk({ sid: 'SM1' }); },
  });

  await enviar({ destino: '+5561999990000', conteudo: 'Oi', channelAccountId: 'c1' });
  assert.equal(corpo.get('To'), '+5561999990000');
  assert.equal(corpo.get('From'), '+14155238886');
});

test('envio real: erro 63016 vira falha definitiva com texto legivel', async () => {
  const enviar = criarTransporteTwilio({
    canal: 'whatsapp',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async () => respostaErro(400, { code: 63016, message: 'Window expired' }),
  });

  await assert.rejects(
    () => enviar({ destino: '+55619', conteudo: 'x', channelAccountId: 'c1' }),
    (erro) => {
      assert.equal(erro.definitiva, true, 'nao deve ser retentado');
      assert.match(erro.message, /janela de 24 horas/i);
      assert.match(erro.message, /template aprovado/, 'precisa dizer o que fazer');
      return true;
    }
  );
});

test('envio real: erro 500 e transitorio e permite retry', async () => {
  const enviar = criarTransporteTwilio({
    canal: 'whatsapp',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async () => respostaErro(500, { code: 20500, message: 'Internal' }),
  });

  await assert.rejects(
    () => enviar({ destino: '+55619', conteudo: 'x', channelAccountId: 'c1' }),
    (erro) => {
      assert.ok(!erro.definitiva, 'falha de servidor precisa poder ser retentada');
      return true;
    }
  );
});

test('envio real: opt-out do contato nao e retentado', async () => {
  const enviar = criarTransporteTwilio({
    canal: 'whatsapp',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async () => respostaErro(400, { code: 21610 }),
  });

  await assert.rejects(
    () => enviar({ destino: '+55619', conteudo: 'x', channelAccountId: 'c1' }),
    (erro) => {
      assert.equal(erro.definitiva, true);
      assert.match(erro.message, /opt-out/);
      return true;
    }
  );
});

test('credenciais: sao decifradas da conta e o token nao aparece na conta', async () => {
  const cifradas = cifrar(JSON.stringify({
    account_sid: 'ACreal', auth_token: 'token-real', numero_origem: '+14155238886',
  }), CHAVE);

  assert.ok(!cifradas.includes('token-real'));

  const repositorio = {
    async obterContaDeCanal() {
      return { id: 'c1', credentials: cifradas, external_account_id: '+14155238886' };
    },
  };

  const resolver = criarResolvedorDeCredenciais({ repositorio });
  const c = await resolver('c1');

  assert.equal(c.accountSid, 'ACreal');
  assert.equal(c.authToken, 'token-real');
  assert.equal(c.from, '+14155238886');
});

test('credenciais: conta sem credencial falha em definitivo com instrucao', async () => {
  const resolver = criarResolvedorDeCredenciais({
    repositorio: { async obterContaDeCanal() { return { id: 'c1', credentials: null }; } },
  });

  await assert.rejects(() => resolver('c1'), (erro) => {
    assert.equal(erro.definitiva, true);
    assert.match(erro.message, /onboarding/);
    return true;
  });
});

test('credenciais: valor corrompido nao vaza fragmento no erro', async () => {
  const resolver = criarResolvedorDeCredenciais({
    repositorio: { async obterContaDeCanal() { return { id: 'c1', credentials: 'v1:lixo:lixo:lixo' }; } },
  });

  await assert.rejects(() => resolver('c1'), (erro) => {
    assert.ok(!erro.message.includes('lixo'), 'a mensagem nao pode repetir o material cifrado');
    assert.match(erro.message, /Refaca a conexao/);
    return true;
  });
});

test('integracao: fila de saida com transporte real preserva janela e teto', async () => {
  const fila = criarFila({ tentativasMaximas: 3, atrasoBaseMs: 5 });
  const repositorio = criarRepositorioMemoria();
  let chamadas = 0;

  const transporte = criarTransporteTwilio({
    canal: 'whatsapp',
    credenciaisDaConta: CREDENCIAIS,
    fetchImpl: async () => { chamadas += 1; return respostaOk({ sid: `SM${chamadas}`, status: 'queued' }); },
  });

  const saida = registrarFilaDeSaida({
    fila, controleDeTaxa: criarControleDeTaxa(), repositorio,
    transportes: { whatsapp: transporte },
  });

  const agora = new Date().toISOString();
  const ontem = new Date(Date.now() - 30 * 3600_000).toISOString();

  saida.enfileirar({ mensagemId: 'ok1', canal: 'whatsapp', destino: '+1', channelAccountId: 'c1', ultimaMensagemDoContatoEm: agora });
  saida.enfileirar({ mensagemId: 'fora', canal: 'whatsapp', destino: '+2', channelAccountId: 'c1', ultimaMensagemDoContatoEm: ontem });
  saida.enfileirar({ mensagemId: 'ok2', canal: 'whatsapp', destino: '+3', channelAccountId: 'c1', ultimaMensagemDoContatoEm: agora });

  fila.bombear();
  await fila.drenar();

  assert.equal((await repositorio.obter('ok1')).delivery_status, 'sent');
  assert.equal((await repositorio.obter('ok2')).delivery_status, 'sent');

  const bloqueada = await repositorio.obter('fora');
  assert.equal(bloqueada.delivery_status, 'failed');
  assert.match(bloqueada.error_reason, /janela de 24 horas/i);
  assert.equal(chamadas, 2, 'a mensagem fora da janela nem chega ao provedor');
});

test('integracao: status real da Twilio vira external_message_id na mensagem', async () => {
  const fila = criarFila({ atrasoBaseMs: 5 });
  const repositorio = criarRepositorioMemoria();

  const saida = registrarFilaDeSaida({
    fila, controleDeTaxa: criarControleDeTaxa(), repositorio,
    transportes: {
      whatsapp: criarTransporteTwilio({
        canal: 'whatsapp',
        credenciaisDaConta: CREDENCIAIS,
        fetchImpl: async () => respostaOk({ sid: 'SMreal123', status: 'queued' }),
      }),
    },
  });

  saida.enfileirar({
    mensagemId: 'm1', canal: 'whatsapp', destino: '+1', channelAccountId: 'c1',
    ultimaMensagemDoContatoEm: new Date().toISOString(),
  });
  fila.bombear();
  await fila.drenar();

  const gravada = await repositorio.obter('m1');
  assert.equal(gravada.external_message_id, 'SMreal123',
    'o id do provedor precisa voltar para a mensagem, senao o callback de status nao acha a linha');
});

test('enderecamento: normaliza destino que ja vem com prefixo', () => {
  assert.equal(_internos.enderecar('whatsapp', 'whatsapp:+55619'), 'whatsapp:+55619');
  assert.equal(_internos.enderecar('sms', 'whatsapp:+55619'), '+55619');
});
