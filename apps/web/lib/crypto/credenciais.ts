import 'server-only';
import crypto from 'node:crypto';

/**
 * Cifragem de credenciais no lado do Next.js.
 *
 * Formato identico ao do worker (`v1:iv:tag:dados`, AES-256-GCM) porque as
 * duas pontas leem a mesma coluna: o onboarding grava, o worker envia. Se os
 * formatos divergirem, a mensagem falha em producao e nao no teste.
 *
 * A duplicacao e consciente — a alternativa seria um pacote compartilhado no
 * monorepo, que so vale a pena quando houver uma terceira ponta.
 */

const VERSAO = 'v1';
const ALGORITMO = 'aes-256-gcm';
const TAMANHO_IV = 12;

function carregarChave(): Buffer {
  const bruta = process.env.ENCRYPTION_KEY;
  if (!bruta) throw new Error('ENCRYPTION_KEY ausente no ambiente do servidor.');

  const buffer = /^[0-9a-f]{64}$/i.test(bruta)
    ? Buffer.from(bruta, 'hex')
    : Buffer.from(bruta, 'base64');

  if (buffer.length !== 32) throw new Error('ENCRYPTION_KEY invalida: sao necessarios 32 bytes.');
  return buffer;
}

export function cifrar(textoPlano: string): string {
  const iv = crypto.randomBytes(TAMANHO_IV);
  const cipher = crypto.createCipheriv(ALGORITMO, carregarChave(), iv);
  const cifrado = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);

  return [
    VERSAO,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    cifrado.toString('base64url'),
  ].join(':');
}
