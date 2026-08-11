/**
 * Idempotencia por chave de deduplicacao de evento.
 *
 * O problema concreto: provedores de mensageria reentregam o mesmo webhook
 * quando nao recebem 200 a tempo. Sem deduplicacao, uma reentrega vira uma
 * segunda mensagem enviada ao cliente, um segundo negocio criado, uma segunda
 * cobranca. Retry e deduplicacao andam juntos: reprocessar so e seguro se o
 * efeito for aplicado uma vez.
 *
 * Tres estados por chave:
 *   em_andamento  — alguem esta processando; a segunda chamada nao executa
 *   concluido     — ja processado; devolve o resultado guardado
 *   (ausente)     — primeira vez
 *
 * Guarda em memoria com TTL nesta etapa. A interface `adaptador` existe para
 * que a troca por Postgres ou Redis, quando houver mais de uma instancia,
 * nao toque em quem chama. Ver ADR-0010.
 */

import { incrementar } from './metrics.js';

const TTL_PADRAO_MS = 24 * 60 * 60 * 1000; // 24h — janela tipica de reentrega

export function criarArmazenamentoMemoria() {
  const dados = new Map();

  const expirado = (registro) => registro.expiraEm <= Date.now();

  return {
    async obter(chave) {
      const registro = dados.get(chave);
      if (!registro) return null;
      if (expirado(registro)) {
        dados.delete(chave);
        return null;
      }
      return registro;
    },
    async salvar(chave, registro) {
      dados.set(chave, registro);
    },
    async remover(chave) {
      dados.delete(chave);
    },
    async limparExpirados() {
      let removidos = 0;
      for (const [chave, registro] of dados) {
        if (expirado(registro)) {
          dados.delete(chave);
          removidos += 1;
        }
      }
      return removidos;
    },
    get tamanho() {
      return dados.size;
    },
  };
}

export function criarIdempotencia({ adaptador = criarArmazenamentoMemoria(), ttlMs = TTL_PADRAO_MS } = {}) {
  return {
    /**
     * Executa `fn` no maximo uma vez por chave.
     * Devolve { resultado, deduplicado } — `deduplicado: true` significa que
     * o efeito ja havia sido aplicado e nada foi executado agora.
     */
    async executarUmaVez(chave, fn) {
      const existente = await adaptador.obter(chave);

      if (existente?.estado === 'concluido') {
        incrementar('worker_idempotencia_total', { desfecho: 'deduplicado' });
        return { resultado: existente.resultado, deduplicado: true };
      }

      if (existente?.estado === 'em_andamento') {
        incrementar('worker_idempotencia_total', { desfecho: 'em_andamento' });
        return { resultado: null, deduplicado: true, emAndamento: true };
      }

      await adaptador.salvar(chave, {
        estado: 'em_andamento',
        expiraEm: Date.now() + ttlMs,
      });

      try {
        const resultado = await fn();
        await adaptador.salvar(chave, {
          estado: 'concluido',
          resultado,
          expiraEm: Date.now() + ttlMs,
        });
        incrementar('worker_idempotencia_total', { desfecho: 'executado' });
        return { resultado, deduplicado: false };
      } catch (erro) {
        // A marca e removida de proposito: falha precisa poder ser
        // reprocessada. Manter 'em_andamento' apos erro transformaria uma
        // falha temporaria em evento perdido para sempre.
        await adaptador.remover(chave);
        incrementar('worker_idempotencia_total', { desfecho: 'falhou' });
        throw erro;
      }
    },

    async jaProcessado(chave) {
      const registro = await adaptador.obter(chave);
      return registro?.estado === 'concluido';
    },

    adaptador,
  };
}
