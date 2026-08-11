/**
 * Logging estruturado com redacao de credenciais.
 *
 * Uma linha JSON por evento, para que a plataforma de logs consiga filtrar
 * por campo em vez de por regex sobre texto livre.
 *
 * A redacao e a parte que importa: vazamento de credencial em log e um dos
 * caminhos mais comuns de incidente, porque log costuma sair do perimetro de
 * seguranca (agregador externo, alerta em canal de chat, captura de tela).
 * Por isso a limpeza acontece aqui, no unico ponto por onde tudo passa, e nao
 * na disciplina de quem chama.
 */

const NIVEIS = { debug: 10, info: 20, warn: 30, error: 40 };
const NIVEL_MINIMO = NIVEIS[process.env.LOG_LEVEL] ?? NIVEIS.info;

// Nome de campo que nunca deve aparecer em log, em qualquer profundidade.
const CHAVES_SENSIVEIS = [
  'password', 'senha', 'token', 'secret', 'segredo', 'apikey', 'api_key',
  'authorization', 'auth', 'credential', 'credencial', 'signature',
  'service_role', 'servicerolekey', 'anonkey', 'anon_key', 'encryption_key',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'cookie',
];

const MASCARA = '[redigido]';

function chaveSensivel(chave) {
  const normalizada = String(chave).toLowerCase().replace(/[-_\s]/g, '');
  return CHAVES_SENSIVEIS.some((s) => normalizada.includes(s.replace(/[-_]/g, '')));
}

/**
 * Percorre o objeto e substitui valores de campos sensiveis.
 * Trata ciclos: um payload de webhook pode conter referencia circular, e um
 * logger que quebra o processo por causa disso e pior do que a falta de log.
 */
function redigir(valor, vistos = new WeakSet()) {
  if (valor === null || typeof valor !== 'object') return valor;
  if (vistos.has(valor)) return '[circular]';
  vistos.add(valor);

  if (Array.isArray(valor)) return valor.map((item) => redigir(item, vistos));

  const saida = {};
  for (const [chave, item] of Object.entries(valor)) {
    saida[chave] = chaveSensivel(chave) ? MASCARA : redigir(item, vistos);
  }
  return saida;
}

function emitir(nivel, msg, contexto = {}) {
  if (NIVEIS[nivel] < NIVEL_MINIMO) return;

  const linha = {
    ts: new Date().toISOString(),
    level: nivel,
    service: 'kommopp-worker',
    msg,
    ...redigir(contexto),
  };

  const destino = nivel === 'error' ? process.stderr : process.stdout;
  destino.write(`${JSON.stringify(linha)}\n`);
}

export const logger = {
  debug: (msg, ctx) => emitir('debug', msg, ctx),
  info: (msg, ctx) => emitir('info', msg, ctx),
  warn: (msg, ctx) => emitir('warn', msg, ctx),
  error: (msg, ctx) => emitir('error', msg, ctx),

  /** Logger filho que carrega contexto fixo (ex.: workspace_id, job_id). */
  child(contextoFixo) {
    return {
      debug: (msg, ctx) => emitir('debug', msg, { ...contextoFixo, ...ctx }),
      info: (msg, ctx) => emitir('info', msg, { ...contextoFixo, ...ctx }),
      warn: (msg, ctx) => emitir('warn', msg, { ...contextoFixo, ...ctx }),
      error: (msg, ctx) => emitir('error', msg, { ...contextoFixo, ...ctx }),
      child: (mais) => logger.child({ ...contextoFixo, ...mais }),
    };
  },
};

export const _internos = { redigir, chaveSensivel };
