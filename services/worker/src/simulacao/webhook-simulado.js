/**
 * Fonte de webhook simulada — existe para provar o criterio de aceite da
 * Etapa 2: "o worker reprocessa webhook simulado com retry/backoff e
 * idempotencia, sem duplicar o efeito externo simulado".
 *
 * Nenhum provedor real. O "efeito externo" e um contador em memoria que
 * representa o que, em producao, seria uma mensagem enviada ao cliente ou um
 * registro criado — algo que doi se acontecer duas vezes.
 *
 * O manipulador falha de proposito nas primeiras tentativas (controlado pelo
 * campo `falhas_ate` do payload) e so entao aplica o efeito. Assim o teste
 * exercita retry, backoff e deduplicacao no mesmo caminho.
 */

import { logger } from '../lib/logger.js';

/** Representa o sistema externo que nao pode receber o efeito duas vezes. */
export const efeitoExterno = {
  aplicacoes: new Map(),

  aplicar(chave, dados) {
    const anterior = this.aplicacoes.get(chave);
    if (anterior) {
      // Nao deve acontecer. Se acontecer, a idempotencia falhou e o registro
      // abaixo e a evidencia.
      anterior.vezes += 1;
      logger.error('EFEITO EXTERNO DUPLICADO', { chave, vezes: anterior.vezes });
      return anterior;
    }
    const registro = { chave, dados, vezes: 1, em: new Date().toISOString() };
    this.aplicacoes.set(chave, registro);
    return registro;
  },

  instantaneo() {
    return {
      total_chaves: this.aplicacoes.size,
      total_aplicacoes: [...this.aplicacoes.values()].reduce((s, r) => s + r.vezes, 0),
      duplicadas: [...this.aplicacoes.values()].filter((r) => r.vezes > 1).length,
      chaves: [...this.aplicacoes.keys()],
    };
  },

  limpar() {
    this.aplicacoes.clear();
  },
};

/** Conta tentativas por chave, para o manipulador saber quando parar de falhar. */
const tentativasPorChave = new Map();

export function registrarFontesSimuladas({ fila, idempotencia, receptor }) {
  receptor.registrarFonte('simulado', {
    // Sem segredo: a fonte simulada nao verifica assinatura. Fontes reais
    // sempre vao definir `segredo` (variavel de ambiente).
    segredo: process.env.WEBHOOK_SIMULADO_SECRET,
    chaveDeduplicacao: (payload) => payload?.event_id,
    tipoJob: 'webhook.simulado',
  });

  fila.registrar('webhook.simulado', async ({ chave, payload }, { log }) => {
    const tentativa = (tentativasPorChave.get(chave) ?? 0) + 1;
    tentativasPorChave.set(chave, tentativa);

    const falharAte = Number(payload?.falhas_ate ?? 0);
    if (tentativa <= falharAte) {
      // Falha proposital: simula provedor indisponivel.
      throw new Error(`falha_proposital_tentativa_${tentativa}`);
    }

    // A idempotencia envolve o efeito, nao o job inteiro: o job pode rodar
    // varias vezes por causa do retry, o efeito so pode ser aplicado uma.
    const { resultado, deduplicado } = await idempotencia.executarUmaVez(chave, async () => {
      return efeitoExterno.aplicar(chave, payload);
    });

    log.info('webhook simulado processado', {
      tentativa,
      deduplicado,
      efeito_em: resultado?.em,
    });

    return { deduplicado, tentativa };
  });

  return { tentativasPorChave };
}

export function limparSimulacao() {
  efeitoExterno.limpar();
  tentativasPorChave.clear();
}
