/**
 * Twilio como BSP do WhatsApp.
 *
 * Modelo: a VirtruvIA tem a conta master; cada channel_account de WhatsApp
 * ganha uma SUBCONTA propria, criada via POST /2010-04-01/Accounts.json. O
 * Account SID e o Auth Token da subconta sao gravados cifrados em
 * channel_accounts.credentials.
 *
 * Por que subconta e nao a conta master compartilhada: isolamento de
 * faturamento, de limites e de incidente. Um cliente com problema de
 * qualidade nao arrasta os outros junto.
 *
 * REGRA INEGOCIAVEL: a integracao usa apenas Account SID e Auth Token. Login
 * e senha do Console Twilio nunca sao pedidos, aceitos nem armazenados — sao
 * credencial de pessoa, dao acesso ao painel inteiro e nao podem ser
 * revogados por escopo.
 */

import { cifrar } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { incrementar } from '../lib/metrics.js';

const BASE = 'https://api.twilio.com/2010-04-01';

function credenciaisMaster() {
  const sid = process.env.TWILIO_MASTER_ACCOUNT_SID;
  const token = process.env.TWILIO_MASTER_AUTH_TOKEN;

  if (!sid || !token) {
    throw new Error(
      'TWILIO_MASTER_ACCOUNT_SID e TWILIO_MASTER_AUTH_TOKEN sao obrigatorios. ' +
      'Configure por variavel de ambiente segura; nunca em codigo ou log.'
    );
  }
  return { sid, token };
}

function cabecalhoBasico(sid, token) {
  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
}

/**
 * Cria a subconta e devolve as credenciais JA CIFRADAS, prontas para
 * channel_accounts.credentials.
 *
 * O texto plano do Auth Token existe apenas dentro desta funcao. Nao e
 * retornado, nao e logado e nao aparece em metrica.
 */
export async function provisionarSubconta({ nomeAmigavel, fetchImpl = fetch }) {
  const { sid, token } = credenciaisMaster();

  const resposta = await fetchImpl(`${BASE}/Accounts.json`, {
    method: 'POST',
    headers: {
      Authorization: cabecalhoBasico(sid, token),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ FriendlyName: nomeAmigavel }).toString(),
  });

  if (!resposta.ok) {
    const detalhe = await resposta.text().catch(() => '');
    incrementar('worker_twilio_subconta_total', { desfecho: 'erro' });
    // O corpo do erro da Twilio nao carrega segredo, mas e truncado por
    // precaucao: log nunca e lugar de payload inteiro de provedor.
    throw new Error(`Falha ao criar subconta Twilio (${resposta.status}): ${detalhe.slice(0, 200)}`);
  }

  const conta = await resposta.json();
  incrementar('worker_twilio_subconta_total', { desfecho: 'ok' });

  logger.info('subconta Twilio provisionada', {
    // Apenas o SID, que e identificador publico. O token nunca.
    account_sid: conta.sid,
    status: conta.status,
  });

  return {
    accountSid: conta.sid,
    status: conta.status,
    credentialsCifradas: cifrar(JSON.stringify({
      account_sid: conta.sid,
      auth_token: conta.auth_token,
      criado_em: new Date().toISOString(),
    })),
  };
}

/**
 * Janela de 24h do WhatsApp.
 *
 * Fora dela, so template aprovado. A mensagem precisa falhar com texto que o
 * atendente entenda — "erro 63016" nao ajuda ninguem a resolver.
 */
export const JANELA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export function verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm, ehTemplate = false }) {
  if (ehTemplate) return { permitido: true };

  if (!ultimaMensagemDoContatoEm) {
    return {
      permitido: false,
      motivo: 'Este contato nunca escreveu para este numero. A primeira mensagem precisa ser um template aprovado pelo WhatsApp.',
    };
  }

  const decorrido = Date.now() - new Date(ultimaMensagemDoContatoEm).getTime();

  if (decorrido > JANELA_WHATSAPP_MS) {
    const horas = Math.floor(decorrido / 3_600_000);
    return {
      permitido: false,
      motivo: `A janela de 24 horas do WhatsApp expirou (ultima mensagem do contato ha ${horas} horas). Envie um template aprovado para reabrir a conversa.`,
    };
  }

  return { permitido: true };
}

/**
 * Limite de mensagens automaticas por conta de canal.
 *
 * O Instagram corta contas que disparam demais, e o corte atinge a conta, nao
 * a mensagem. Por isso o teto e por channel_account: uma conta agressiva nao
 * pode derrubar as outras do mesmo workspace.
 */
export const TETO_POR_CANAL = {
  instagram: 200, // por hora, por conta — exigencia explicita do escopo
};

export function criarControleDeTaxa({ agora = () => Date.now() } = {}) {
  const janelas = new Map();
  const UMA_HORA = 3_600_000;

  return {
    /** Consulta e consome uma unidade, se houver. */
    permitir({ channelAccountId, canal, ehAutomatica = true }) {
      // Mensagem escrita por gente nao entra no teto: o limite existe para
      // conter disparo automatico, nao para calar o atendente.
      if (!ehAutomatica) return { permitido: true };

      const teto = TETO_POR_CANAL[canal];
      if (!teto) return { permitido: true };

      const agoraMs = agora();
      const registro = janelas.get(channelAccountId) ?? { inicio: agoraMs, contagem: 0 };

      if (agoraMs - registro.inicio >= UMA_HORA) {
        registro.inicio = agoraMs;
        registro.contagem = 0;
      }

      if (registro.contagem >= teto) {
        janelas.set(channelAccountId, registro);
        incrementar('worker_limite_canal_total', { canal, desfecho: 'bloqueado' });
        const minutos = Math.ceil((UMA_HORA - (agoraMs - registro.inicio)) / 60000);
        return {
          permitido: false,
          motivo: `Limite de ${teto} mensagens automaticas por hora atingido nesta conta de ${canal}. Libera em ${minutos} minutos.`,
        };
      }

      registro.contagem += 1;
      janelas.set(channelAccountId, registro);
      return { permitido: true, restante: teto - registro.contagem };
    },

    consumo(channelAccountId) {
      return janelas.get(channelAccountId)?.contagem ?? 0;
    },
  };
}
