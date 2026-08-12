/**
 * Fila de saida.
 *
 * O requisito central e negativo: falha em uma mensagem nao pode bloquear as
 * proximas nem impedir automacoes futuras. O descritivo aponta esse travamento
 * como defeito do produto substituido.
 *
 * Por isso cada mensagem e um job independente na fila da Etapa 2 — com retry,
 * backoff e carta morta — e o desfecho vira `delivery_status` na propria
 * mensagem. Nada morre em silencio: ou a mensagem chega, ou fica `failed` com
 * `error_reason` legivel.
 */

import { logger } from '../lib/logger.js';
import { incrementar } from '../lib/metrics.js';
import { verificarJanelaWhatsApp } from './twilio.js';

export const TIPO_JOB_SAIDA = 'canal.enviar';

/**
 * Erro que NAO deve ser retentado: a proxima tentativa daria o mesmo
 * resultado. Janela expirada e limite de conta sao assim — insistir so
 * queima reputacao do numero.
 */
export class FalhaDefinitiva extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = 'FalhaDefinitiva';
    this.definitiva = true;
  }
}

export function registrarFilaDeSaida({ fila, controleDeTaxa, repositorio, transportes }) {
  fila.registrar(TIPO_JOB_SAIDA, async (payload, { log }) => {
    const { mensagemId, canal, channelAccountId, destino, conteudo, ehTemplate, ehAutomatica,
            ultimaMensagemDoContatoEm } = payload;

    try {
      // 1. Janela do WhatsApp
      if (canal === 'whatsapp') {
        const janela = verificarJanelaWhatsApp({ ultimaMensagemDoContatoEm, ehTemplate });
        if (!janela.permitido) throw new FalhaDefinitiva(janela.motivo);
      }

      // 2. Teto por conta de canal
      const taxa = controleDeTaxa.permitir({ channelAccountId, canal, ehAutomatica });
      if (!taxa.permitido) throw new FalhaDefinitiva(taxa.motivo);

      // 3. Transporte
      const transporte = transportes[canal];
      if (!transporte) throw new FalhaDefinitiva(`Canal ${canal} sem transporte configurado.`);

      const resultado = await transporte({ destino, conteudo, channelAccountId });

      await repositorio.atualizarEntrega(mensagemId, {
        delivery_status: 'sent',
        external_message_id: resultado?.idExterno ?? null,
        error_reason: null,
      });

      incrementar('worker_saida_total', { canal, desfecho: 'sent' });
      log.info('mensagem enviada', { mensagem_id: mensagemId, canal });
      return { enviada: true };
    } catch (erro) {
      if (erro.definitiva) {
        // Falha definitiva: grava o motivo e encerra. Nao retenta.
        await repositorio.atualizarEntrega(mensagemId, {
          delivery_status: 'failed',
          error_reason: erro.message,
        });
        incrementar('worker_saida_total', { canal, desfecho: 'failed_definitiva' });
        log.warn('mensagem recusada em definitivo', { mensagem_id: mensagemId, motivo: erro.message });
        // Nao relanca: para a fila, o job terminou. Insistir seria inutil, e
        // deixar o job cair na carta morta esconderia o motivo do atendente.
        return { enviada: false, definitiva: true };
      }

      // Falha transitoria: relanca para a fila aplicar backoff e retentar.
      incrementar('worker_saida_total', { canal, desfecho: 'retry' });
      await repositorio.atualizarEntrega(mensagemId, {
        delivery_status: 'queued',
        error_reason: `Tentativa falhou: ${erro.message}`,
      });
      throw erro;
    }
  });

  return {
    enfileirar(mensagem) {
      incrementar('worker_saida_total', { canal: mensagem.canal, desfecho: 'queued' });
      return fila.enfileirar(TIPO_JOB_SAIDA, mensagem, { id: `saida:${mensagem.mensagemId}` });
    },
  };
}

/**
 * Repositorio em memoria, para teste e para o esqueleto desta etapa.
 * A versao com Supabase entra quando o worker receber a chave de servico.
 */
export function criarRepositorioMemoria() {
  const mensagens = new Map();

  return {
    async atualizarEntrega(id, campos) {
      mensagens.set(id, { ...(mensagens.get(id) ?? { id }), ...campos });
      return mensagens.get(id);
    },
    async obter(id) {
      return mensagens.get(id) ?? null;
    },
    get todas() {
      return [...mensagens.values()];
    },
  };
}
