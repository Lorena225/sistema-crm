/**
 * Criptografia de credenciais persistidas.
 *
 * As etapas seguintes vao guardar token de canal, chave de integracao e
 * credencial de provedor no banco. Nenhuma delas pode ficar em texto plano:
 * quem obtiver uma copia do banco nao pode sair enviando mensagem em nome
 * dos clientes.
 *
 * AES-256-GCM, escolhido por ser autenticado: alem de cifrar, detecta
 * adulteracao do texto cifrado. Com AES-CBC, um byte trocado passa
 * despercebido e vira lixo silencioso.
 *
 * Formato guardado: v1:<iv>:<tag>:<cifrado>, tudo em base64url. O prefixo de
 * versao existe para permitir rotacao de algoritmo sem precisar adivinhar o
 * formato do que ja esta gravado.
 */

import crypto from 'node:crypto';

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;  // recomendado para GCM
const TAMANHO_TAG = 16;

/**
 * A chave vem de ENCRYPTION_KEY (32 bytes em base64 ou 64 caracteres hex).
 * Gerar uma: `openssl rand -base64 32`.
 * Nunca commitar; em producao, usar variavel de ambiente ou Supabase Vault.
 */
function carregarChave(chaveBruta = process.env.ENCRYPTION_KEY) {
  if (!chaveBruta) {
    throw new Error('ENCRYPTION_KEY ausente: credenciais nao podem ser cifradas.');
  }

  const buffer = /^[0-9a-f]{64}$/i.test(chaveBruta)
    ? Buffer.from(chaveBruta, 'hex')
    : Buffer.from(chaveBruta, 'base64');

  if (buffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY invalida: sao necessarios 32 bytes (base64 ou hex).');
  }

  return buffer;
}

export function cifrar(textoPlano, chaveBruta) {
  const chave = carregarChave(chaveBruta);
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, chave, iv);

  const cifrado = Buffer.concat([
    cipher.update(String(textoPlano), 'utf8'),
    cipher.final(),
  ]);

  return [
    VERSAO,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    cifrado.toString('base64url'),
  ].join(':');
}

export function decifrar(valorGuardado, chaveBruta) {
  const chave = carregarChave(chaveBruta);
  const [versao, ivB64, tagB64, cifradoB64] = String(valorGuardado).split(':');

  if (versao !== VERSAO) {
    throw new Error(`Versao de cifragem desconhecida: ${versao}`);
  }

  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');

  if (iv.length !== TAMANHO_IV || tag.length !== TAMANHO_TAG) {
    throw new Error('Valor cifrado malformado.');
  }

  const decipher = crypto.createDecipheriv(ALGORITMO, chave, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(Buffer.from(cifradoB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Comparacao em tempo constante, para assinatura de webhook.
 * `a === b` vaza informacao pelo tempo de resposta: quanto mais bytes iniciais
 * coincidem, mais demora a comparacao, e isso permite descobrir a assinatura
 * byte a byte.
 */
export function compararSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** HMAC-SHA256 em hex — formato usado pela maioria dos provedores. */
export function assinar(payload, segredo) {
  return crypto.createHmac('sha256', String(segredo)).update(String(payload)).digest('hex');
}

export function verificarAssinatura(payload, assinatura, segredo) {
  return compararSeguro(assinar(payload, segredo), assinatura);
}
