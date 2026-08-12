/**
 * Normalizacao de eventos de canal.
 *
 * Cada provedor descreve a mesma coisa de um jeito: o Twilio manda
 * `MessageSid` e `From`, o Meta manda `messages[0].id` e `from`, o Telegram
 * manda `message.message_id` e `chat.id`. Se essa diferenca vazar para o
 * resto do sistema, cada regra de negocio precisa conhecer sete formatos.
 *
 * Aqui tudo vira a mesma forma canonica, que e exatamente o formato da tabela
 * `messages`. O restante do worker so conhece esse formato.
 */

import { logger } from '../lib/logger.js';

/** Forma canonica devolvida por todo normalizador. */
function canonica({
  canal, idExterno, remetente, conteudo = null, urlMidia = null,
  tipoMidia = 'text', duracaoSegundos = null, bruto,
}) {
  return {
    canal,
    external_message_id: idExterno,
    remetente_externo: remetente,
    direction: 'inbound',
    sender_type: 'contact',
    content: conteudo,
    media_url: urlMidia,
    media_type: tipoMidia,
    duration_seconds: duracaoSegundos,
    delivery_status: 'delivered',
    bruto,
  };
}

const TIPO_POR_MIME = (mime = '') => {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime) return 'document';
  return 'text';
};

export const normalizadores = {
  /** Twilio (WhatsApp e SMS): corpo em formato de formulario. */
  twilio(payload) {
    const midia = Number(payload.NumMedia ?? 0) > 0;
    const canal = String(payload.From ?? '').startsWith('whatsapp:') ? 'whatsapp' : 'sms';

    return canonica({
      canal,
      idExterno: payload.MessageSid ?? payload.SmsSid,
      remetente: String(payload.From ?? '').replace('whatsapp:', ''),
      conteudo: payload.Body || null,
      urlMidia: midia ? payload.MediaUrl0 : null,
      tipoMidia: midia ? TIPO_POR_MIME(payload.MediaContentType0) : 'text',
      bruto: payload,
    });
  },

  /** Meta: Instagram Direct e Messenger compartilham o mesmo envelope. */
  meta(payload) {
    const entrada = payload?.entry?.[0];
    const evento = entrada?.messaging?.[0];
    if (!evento) return null;

    const anexo = evento.message?.attachments?.[0];
    const canal = entrada?.messaging_product === 'instagram' || payload.object === 'instagram'
      ? 'instagram' : 'messenger';

    return canonica({
      canal,
      idExterno: evento.message?.mid,
      remetente: evento.sender?.id,
      conteudo: evento.message?.text ?? null,
      urlMidia: anexo?.payload?.url ?? null,
      tipoMidia: anexo ? (anexo.type === 'audio' ? 'audio' : anexo.type ?? 'document') : 'text',
      bruto: payload,
    });
  },

  telegram(payload) {
    const msg = payload?.message;
    if (!msg) return null;

    const voz = msg.voice ?? msg.audio;

    return canonica({
      canal: 'telegram',
      idExterno: `tg_${msg.message_id}`,
      remetente: String(msg.chat?.id),
      conteudo: msg.text ?? msg.caption ?? null,
      urlMidia: voz?.file_id ?? msg.photo?.at(-1)?.file_id ?? null,
      tipoMidia: voz ? 'audio' : msg.photo ? 'image' : msg.document ? 'document' : 'text',
      duracaoSegundos: voz?.duration ?? null,
      bruto: payload,
    });
  },

  email(payload) {
    return canonica({
      canal: 'email',
      idExterno: payload.messageId ?? payload['message-id'],
      remetente: payload.from,
      conteudo: payload.text ?? payload.html ?? null,
      bruto: payload,
    });
  },

  webchat(payload) {
    return canonica({
      canal: 'webchat',
      idExterno: payload.id,
      remetente: payload.visitor_id,
      conteudo: payload.text ?? null,
      bruto: payload,
    });
  },
};

export function normalizar(fonte, payload) {
  const fn = normalizadores[fonte];
  if (!fn) {
    logger.warn('fonte de canal sem normalizador', { fonte });
    return null;
  }

  const normalizada = fn(payload);

  if (!normalizada?.external_message_id) {
    // Sem identificador externo nao ha deduplicacao possivel, e reentrega do
    // provedor viraria mensagem repetida na conversa.
    logger.warn('evento sem identificador externo, descartado', { fonte });
    return null;
  }

  return normalizada;
}
