/**
 * Transporte real via Twilio.
 *
 * Substitui o mapa injetado da Etapa 5. O contrato com a fila de saida nao
 * mudou: recebe `{ destino, conteudo, channelAccountId }` e devolve
 * `{ idExterno }` — ou levanta erro. Toda a logica de janela, teto por conta,
 * retry e backoff continua onde estava, agora com provedor de verdade atras.
 *
 * Credencial: cada channel_account de WhatsApp tem a propria subconta, cujo
 * SID e token estao cifrados em `channel_accounts.credentials`. O envio usa a
 * credencial da SUBCONTA, nao a da master — a master so serve para criar
 * subconta. Isso limita o estrago de um vazamento a um cliente.
 */

import { decifrar } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { incrementar } from '../lib/metrics.js';
import { FalhaDefinitiva } from './fila-saida.js';

const BASE = 'https://api.twilio.com/2010-04-01';

/**
 * Codigos da Twilio que nao adianta retentar: o problema esta na mensagem ou
 * na conversa, nao na rede. Retentar so consome cota e prejudica a reputacao
 * do numero.
 * https://www.twilio.com/docs/api/errors
 */
const ERROS_DEFINITIVOS = new Map([
  [63016, 'A janela de 24 horas do WhatsApp expirou. Envie um template aprovado para reabrir a conversa.'],
  [63018, 'Limite de mensagens da conta atingido no WhatsApp. Aguarde a janela liberar.'],
  [63024, 'Numero de destino invalido para WhatsApp.'],
  [63003, 'O destinatario nao foi encontrado neste canal.'],
  [21211, 'Numero de telefone invalido.'],
  [21610, 'O contato pediu para nao receber mais mensagens (opt-out).'],
  [21612, 'Este numero nao pode enviar para o destino informado.'],
  [63007, 'A conta de WhatsApp nao esta configurada para este numero de origem.'],
]);

function autorizacao(sid, token) {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/** Prefixo exigido pelo canal. O Twilio distingue WhatsApp de SMS pelo `whatsapp:`. */
function enderecar(canal, numero) {
  const limpo = String(numero).replace(/^whatsapp:/, '');
  return canal === 'whatsapp' ? `whatsapp:${limpo}` : limpo;
}

/**
 * Cria o transporte de um canal.
 *
 * @param {object} opcoes
 * @param {Function} opcoes.credenciaisDaConta  (channelAccountId) => { accountSid, authToken, from }
 * @param {Function} [opcoes.fetchImpl]         injetavel para teste
 */
export function criarTransporteTwilio({ credenciaisDaConta, fetchImpl = fetch, canal }) {
  return async function enviar({ destino, conteudo, channelAccountId, urlMidia }) {
    const { accountSid, authToken, from } = await credenciaisDaConta(channelAccountId);

    if (!accountSid || !authToken) {
      throw new FalhaDefinitiva(
        'Esta conta de canal nao tem credenciais Twilio gravadas. Refaca a conexao pelo onboarding.'
      );
    }

    const corpo = new URLSearchParams({
      From: enderecar(canal, from),
      To: enderecar(canal, destino),
    });

    if (conteudo) corpo.set('Body', conteudo);
    if (urlMidia) corpo.set('MediaUrl', urlMidia);

    const resposta = await fetchImpl(`${BASE}/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: autorizacao(accountSid, authToken),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: corpo.toString(),
    });

    if (!resposta.ok) {
      const erro = await resposta.json().catch(() => ({}));
      const codigo = Number(erro?.code);
      const traduzido = ERROS_DEFINITIVOS.get(codigo);

      incrementar('worker_twilio_envio_total', { canal, desfecho: 'erro', codigo: codigo || 'desconhecido' });

      if (traduzido) {
        // Definitiva: a fila grava `failed` com este texto e nao retenta.
        throw new FalhaDefinitiva(traduzido);
      }

      // 429 e 5xx sao transitorios: a fila retenta com backoff.
      throw new Error(
        `Twilio recusou o envio (HTTP ${resposta.status}, codigo ${codigo || 'n/d'}): ${erro?.message ?? 'sem detalhe'}`
      );
    }

    const dados = await resposta.json();
    incrementar('worker_twilio_envio_total', { canal, desfecho: 'ok' });

    // O SID e identificador publico; o token nunca entra em log.
    logger.info('mensagem entregue ao provedor', {
      canal, message_sid: dados.sid, status: dados.status,
    });

    return { idExterno: dados.sid, statusProvedor: dados.status };
  };
}

/**
 * Resolve as credenciais de uma conta de canal a partir do banco, decifrando.
 * O texto plano existe apenas dentro do processo, no momento do envio.
 */
export function criarResolvedorDeCredenciais({ repositorio, cache = new Map() }) {
  return async function credenciaisDaConta(channelAccountId) {
    if (cache.has(channelAccountId)) return cache.get(channelAccountId);

    const conta = await repositorio.obterContaDeCanal(channelAccountId);
    if (!conta) throw new FalhaDefinitiva('Conta de canal nao encontrada.');

    if (!conta.credentials) {
      throw new FalhaDefinitiva('Conta de canal sem credenciais. Conecte o canal pelo onboarding.');
    }

    let credenciais;
    try {
      credenciais = JSON.parse(decifrar(conta.credentials));
    } catch {
      // Nao repassamos o erro original: ele poderia carregar fragmento do
      // material cifrado para o log.
      throw new FalhaDefinitiva('Nao foi possivel ler as credenciais desta conta. Refaca a conexao.');
    }

    const resolvido = {
      accountSid: credenciais.account_sid,
      authToken: credenciais.auth_token,
      from: credenciais.numero_origem ?? conta.external_account_id,
    };

    cache.set(channelAccountId, resolvido);
    return resolvido;
  };
}

/** Sandbox do WhatsApp: numero de teste comum a todas as contas Twilio. */
export const SANDBOX_WHATSAPP = '+14155238886';

export const _internos = { ERROS_DEFINITIVOS, enderecar };
