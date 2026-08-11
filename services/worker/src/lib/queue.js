/**
 * Fila com retry, backoff exponencial e falha isolada.
 *
 * Tres propriedades que o produto depende:
 *
 * 1. Falha isolada — um job que estoura nao derruba o processo nem trava a
 *    fila. O prompt do produto cita literalmente automacoes que "travam apos
 *    falha de envio" como defeito a evitar.
 * 2. Backoff exponencial com jitter — reentrega imediata em rajada e como
 *    bater na porta de um provedor que ja esta caindo. O jitter evita que N
 *    jobs que falharam juntos voltem juntos.
 * 3. Carta morta — depois de esgotar as tentativas, o job sai da fila mas nao
 *    some. Evento perdido em silencio e pior do que evento com falha visivel.
 *
 * Em memoria nesta etapa; a interface de armazenamento esta isolada para a
 * troca por fila persistente. Ver ADR-0010.
 */

import { logger } from './logger.js';
import { incrementar, observar } from './metrics.js';

const PADROES = {
  tentativasMaximas: 5,
  atrasoBaseMs: 200,
  atrasoMaximoMs: 30_000,
  concorrencia: 1,
};

/** Backoff exponencial com jitter: base * 2^(n-1), com ate 20% de variacao. */
export function calcularAtraso(tentativa, { atrasoBaseMs, atrasoMaximoMs }) {
  const bruto = Math.min(atrasoBaseMs * 2 ** (tentativa - 1), atrasoMaximoMs);
  const jitter = bruto * 0.2 * Math.random();
  return Math.round(bruto - bruto * 0.1 + jitter);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function criarFila(opcoes = {}) {
  const config = { ...PADROES, ...opcoes };
  const pendentes = [];
  const cartaMorta = [];
  const manipuladores = new Map();

  let processando = false;
  let ativos = 0;
  let encerrando = false;

  function registrar(tipo, manipulador) {
    manipuladores.set(tipo, manipulador);
  }

  function enfileirar(tipo, payload, meta = {}) {
    const job = {
      id: meta.id ?? `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      tipo,
      payload,
      tentativa: 0,
      criadoEm: Date.now(),
      ...meta,
    };
    pendentes.push(job);
    incrementar('worker_fila_enfileirados_total', { tipo });
    logger.debug('job enfileirado', { job_id: job.id, tipo });
    return job.id;
  }

  async function executarJob(job) {
    const manipulador = manipuladores.get(job.tipo);
    const log = logger.child({ job_id: job.id, tipo: job.tipo });

    if (!manipulador) {
      log.error('nenhum manipulador registrado para o tipo');
      cartaMorta.push({ job, motivo: 'sem_manipulador' });
      incrementar('worker_fila_carta_morta_total', { tipo: job.tipo, motivo: 'sem_manipulador' });
      return;
    }

    job.tentativa += 1;
    const inicio = Date.now();

    try {
      const resultado = await manipulador(job.payload, { job, log });
      observar('worker_job_duracao_ms', Date.now() - inicio, { tipo: job.tipo, resultado: 'ok' });
      incrementar('worker_fila_concluidos_total', { tipo: job.tipo });
      log.info('job concluido', { tentativa: job.tentativa });
      return resultado;
    } catch (erro) {
      // Falha isolada: o erro morre aqui dentro. O processo segue.
      observar('worker_job_duracao_ms', Date.now() - inicio, { tipo: job.tipo, resultado: 'erro' });
      incrementar('worker_fila_falhas_total', { tipo: job.tipo });

      if (job.tentativa >= config.tentativasMaximas) {
        cartaMorta.push({ job, motivo: 'tentativas_esgotadas', erro: erro.message });
        incrementar('worker_fila_carta_morta_total', { tipo: job.tipo, motivo: 'tentativas_esgotadas' });
        log.error('job para a carta morta', { tentativa: job.tentativa, erro: erro.message });
        return;
      }

      const atraso = calcularAtraso(job.tentativa, config);
      log.warn('job falhou, reagendado', { tentativa: job.tentativa, atraso_ms: atraso, erro: erro.message });

      setTimeout(() => {
        if (!encerrando) {
          pendentes.push(job);
          bombear();
        }
      }, atraso);
    }
  }

  async function bombear() {
    if (processando) return;
    processando = true;

    while (pendentes.length > 0 && !encerrando) {
      while (ativos >= config.concorrencia) await dormir(5);
      const job = pendentes.shift();
      ativos += 1;
      executarJob(job).finally(() => {
        ativos -= 1;
      });
    }

    processando = false;
  }

  /** Espera a fila esvaziar. Existe para teste e para encerramento limpo. */
  async function drenar({ timeoutMs = 15_000 } = {}) {
    const limite = Date.now() + timeoutMs;
    while ((pendentes.length > 0 || ativos > 0) && Date.now() < limite) {
      await dormir(10);
    }
    // Um ciclo extra: jobs reagendados entram por setTimeout.
    await dormir(50);
    if (pendentes.length > 0 || ativos > 0) {
      return drenar({ timeoutMs: Math.max(0, limite - Date.now()) });
    }
  }

  return {
    registrar,
    enfileirar,
    bombear,
    drenar,
    encerrar() {
      encerrando = true;
    },
    get estado() {
      return {
        pendentes: pendentes.length,
        ativos,
        carta_morta: cartaMorta.length,
        tipos_registrados: [...manipuladores.keys()],
      };
    },
    get cartaMorta() {
      return [...cartaMorta];
    },
  };
}
