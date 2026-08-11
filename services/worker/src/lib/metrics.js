/**
 * Metricas basicas: contadores e histogramas em memoria, expostos em
 * /metrics no formato de exposicao do Prometheus.
 *
 * Em memoria e suficiente agora porque o worker ainda e um processo unico e
 * o objetivo e ter o contrato de observabilidade pronto antes da carga real.
 * Quando houver mais de uma instancia, o coletor agrega por instancia — e o
 * formato ja e o esperado por qualquer scraper.
 */

const contadores = new Map();
const histogramas = new Map();

const FAIXAS_MS = [5, 25, 100, 500, 2000, 10000];

function chaveDe(nome, rotulos = {}) {
  const partes = Object.entries(rotulos)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`);
  return partes.length ? `${nome}{${partes.join(',')}}` : nome;
}

export function incrementar(nome, rotulos = {}, quanto = 1) {
  const chave = chaveDe(nome, rotulos);
  contadores.set(chave, (contadores.get(chave) ?? 0) + quanto);
}

export function observar(nome, duracaoMs, rotulos = {}) {
  const chave = chaveDe(nome, rotulos);
  const atual = histogramas.get(chave) ?? {
    contagem: 0,
    soma: 0,
    faixas: new Array(FAIXAS_MS.length).fill(0),
  };

  atual.contagem += 1;
  atual.soma += duracaoMs;
  FAIXAS_MS.forEach((limite, i) => {
    if (duracaoMs <= limite) atual.faixas[i] += 1;
  });

  histogramas.set(chave, atual);
}

/** Cronometra uma funcao assincrona e registra sucesso ou falha. */
export async function cronometrar(nome, rotulos, fn) {
  const inicio = Date.now();
  try {
    const resultado = await fn();
    observar(nome, Date.now() - inicio, { ...rotulos, resultado: 'ok' });
    return resultado;
  } catch (erro) {
    observar(nome, Date.now() - inicio, { ...rotulos, resultado: 'erro' });
    throw erro;
  }
}

export function exportar() {
  const linhas = [];

  for (const [chave, valor] of contadores) {
    linhas.push(`${chave} ${valor}`);
  }

  for (const [chave, h] of histogramas) {
    const [nome, rotulos = ''] = chave.split('{');
    const sufixo = rotulos ? `,${rotulos}` : '}';
    FAIXAS_MS.forEach((limite, i) => {
      const base = rotulos ? `{le="${limite}"${sufixo}` : `{le="${limite}"}`;
      linhas.push(`${nome}_bucket${base} ${h.faixas[i]}`);
    });
    linhas.push(`${nome}_sum${rotulos ? `{${rotulos}` : ''} ${h.soma}`);
    linhas.push(`${nome}_count${rotulos ? `{${rotulos}` : ''} ${h.contagem}`);
  }

  return `${linhas.join('\n')}\n`;
}

export function instantaneo() {
  return {
    contadores: Object.fromEntries(contadores),
    histogramas: Object.fromEntries(
      [...histogramas].map(([k, v]) => [k, { contagem: v.contagem, soma_ms: v.soma }])
    ),
  };
}

export function limpar() {
  contadores.clear();
  histogramas.clear();
}
