/**
 * Receptor generico de webhook.
 *
 * Junta as tres primitivas na ordem que importa:
 *
 *   1. assinatura  — payload nao autenticado nem chega a ser enfileirado
 *   2. idempotencia — chave de deduplicacao extraida do evento
 *   3. fila        — o trabalho pesado sai do ciclo da requisicao
 *
 * A ordem tem uma razao pratica: provedores esperam 200 rapido e reentregam
 * se demorar. Responder 202 assim que o evento esta aceito, e processar
 * depois, e o que impede que lentidao nossa vire enxurrada de reentrega.
 *
 * Nenhum provedor real esta integrado nesta etapa — apenas o contrato.
 */

import { logger } from './logger.js';
import { incrementar } from './metrics.js';
import { verificarAssinatura } from './crypto.js';

export function criarReceptorWebhook({ fila, idempotencia, fontes = {} }) {
  /**
   * Registra uma fonte de webhook.
   * @param {string} nome            identificador da fonte (ex.: 'twilio')
   * @param {object} opcoes
   * @param {string} opcoes.segredo  segredo de assinatura; ausente = sem verificacao
   * @param {Function} opcoes.chaveDeduplicacao  (payload) => string
   * @param {string} opcoes.tipoJob  tipo de job enfileirado
   */
  function registrarFonte(nome, opcoes) {
    fontes[nome] = {
      chaveDeduplicacao: (p) => p?.id ?? p?.event_id,
      ...opcoes,
    };
  }

  async function receber({ fonte, corpoBruto, assinatura, cabecalhos = {} }) {
    const config = fontes[fonte];
    const log = logger.child({ fonte });

    if (!config) {
      incrementar('worker_webhook_total', { fonte, desfecho: 'fonte_desconhecida' });
      return { status: 404, corpo: { erro: 'fonte_desconhecida' } };
    }

    // 1. Assinatura
    if (config.segredo) {
      if (!assinatura || !verificarAssinatura(corpoBruto, assinatura, config.segredo)) {
        incrementar('worker_webhook_total', { fonte, desfecho: 'assinatura_invalida' });
        log.warn('assinatura de webhook invalida');
        return { status: 401, corpo: { erro: 'assinatura_invalida' } };
      }
    }

    // 2. Payload
    let payload;
    try {
      payload = JSON.parse(corpoBruto);
    } catch {
      incrementar('worker_webhook_total', { fonte, desfecho: 'payload_invalido' });
      return { status: 400, corpo: { erro: 'payload_invalido' } };
    }

    // 3. Chave de deduplicacao
    const idEvento = config.chaveDeduplicacao(payload, cabecalhos);
    if (!idEvento) {
      incrementar('worker_webhook_total', { fonte, desfecho: 'sem_id_evento' });
      return { status: 400, corpo: { erro: 'sem_id_evento' } };
    }

    const chave = `${fonte}:${idEvento}`;

    if (await idempotencia.jaProcessado(chave)) {
      incrementar('worker_webhook_total', { fonte, desfecho: 'deduplicado' });
      log.info('webhook ja processado, ignorado', { chave });
      return { status: 200, corpo: { status: 'deduplicado', chave } };
    }

    // 4. Fila — a requisicao termina aqui; o trabalho continua depois.
    fila.enfileirar(config.tipoJob, { chave, fonte, payload }, { id: chave });
    fila.bombear();

    incrementar('worker_webhook_total', { fonte, desfecho: 'aceito' });
    return { status: 202, corpo: { status: 'aceito', chave } };
  }

  return { registrarFonte, receber, get fontes() { return Object.keys(fontes); } };
}
