/**
 * Repositorio Supabase do worker.
 *
 * Fala com o PostgREST por HTTP, sem SDK: o worker continua sem dependencia
 * npm, e o que precisamos aqui sao cinco chamadas simples.
 *
 * Usa a service role, que ignora RLS — e por isso vive somente no servidor
 * persistente, nunca no navegador. Toda consulta filtra explicitamente por
 * `workspace_id` quando o dado e de tenant: com service role, esquecer o
 * filtro nao da erro, vaza.
 */

import { logger } from '../lib/logger.js';

function configuracao() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !chave) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios no worker. ' +
      'Configure por variavel de ambiente segura.'
    );
  }
  return { url: url.replace(/\/$/, ''), chave };
}

export function criarRepositorioSupabase({ fetchImpl = fetch } = {}) {
  async function chamar(caminho, opcoes = {}) {
    const { url, chave } = configuracao();

    const resposta = await fetchImpl(`${url}/rest/v1/${caminho}`, {
      ...opcoes,
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json',
        Prefer: opcoes.prefer ?? 'return=representation',
        ...(opcoes.headers ?? {}),
      },
    });

    if (!resposta.ok) {
      const detalhe = await resposta.text().catch(() => '');
      throw new Error(`Supabase respondeu ${resposta.status}: ${detalhe.slice(0, 200)}`);
    }

    if (resposta.status === 204) return null;
    return resposta.json();
  }

  return {
    async obterContaDeCanal(id) {
      const linhas = await chamar(
        `channel_accounts?id=eq.${encodeURIComponent(id)}&select=id,workspace_id,channel_type,external_account_id,credentials,status&limit=1`
      );
      return linhas?.[0] ?? null;
    },

    /** Localiza a conta pelo numero que recebeu o evento. */
    async obterContaPorNumero(numero, canal) {
      const limpo = String(numero).replace(/^whatsapp:/, '');
      const linhas = await chamar(
        `channel_accounts?channel_type=eq.${canal}&external_account_id=eq.${encodeURIComponent(limpo)}&select=id,workspace_id,channel_type&limit=1`
      );
      return linhas?.[0] ?? null;
    },

    async atualizarEntrega(mensagemId, campos) {
      return chamar(`messages?id=eq.${encodeURIComponent(mensagemId)}`, {
        method: 'PATCH',
        body: JSON.stringify(campos),
      });
    },

    /** Atualiza o status pelo identificador do provedor (callback de status). */
    async atualizarEntregaPorIdExterno(idExterno, campos) {
      return chamar(`messages?external_message_id=eq.${encodeURIComponent(idExterno)}`, {
        method: 'PATCH',
        body: JSON.stringify(campos),
      });
    },

    /**
     * Encontra ou cria a conversa daquele contato naquela conta de canal.
     *
     * Nao duplica contato: procura por telefone dentro do workspace antes de
     * criar. Um mesmo contato pode ter conversas simultaneas em canais
     * diferentes — o que nao pode e virar dois cadastros.
     */
    async encontrarOuCriarConversa({ conta, remetente, nome }) {
      const abertas = await chamar(
        `conversations?workspace_id=eq.${conta.workspace_id}&channel_account_id=eq.${conta.id}` +
        `&status=in.(open,pending)&select=id,contact_id&order=last_message_at.desc&limit=1` +
        (remetente ? `&contacts.phone=eq.${encodeURIComponent(remetente)}` : '')
      );
      if (abertas?.[0]) return abertas[0];

      let contato = null;
      if (remetente) {
        const achados = await chamar(
          `contacts?workspace_id=eq.${conta.workspace_id}&phone=eq.${encodeURIComponent(remetente)}&select=id&limit=1`
        );
        contato = achados?.[0] ?? null;
      }

      if (!contato) {
        const criados = await chamar('contacts', {
          method: 'POST',
          body: JSON.stringify({
            workspace_id: conta.workspace_id,
            name: nome || remetente || 'Contato sem identificacao',
            phone: remetente ?? null,
            source: `canal:${conta.channel_type}`,
          }),
        });
        contato = criados?.[0];
      }

      const conversas = await chamar('conversations', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: conta.workspace_id,
          channel_account_id: conta.id,
          contact_id: contato.id,
        }),
      });

      return conversas?.[0];
    },

    /**
     * Grava a mensagem recebida. Conflito no identificador externo significa
     * reentrega do provedor: o indice unico da Etapa 5 recusa, e o evento e
     * ignorado em silencio proposital.
     */
    async registrarMensagemRecebida(conversaId, normalizada) {
      try {
        const linhas = await chamar('messages', {
          method: 'POST',
          body: JSON.stringify({
            conversation_id: conversaId,
            direction: 'inbound',
            sender_type: 'contact',
            content: normalizada.content,
            media_url: normalizada.media_url,
            media_type: normalizada.media_type,
            duration_seconds: normalizada.duration_seconds,
            external_message_id: normalizada.external_message_id,
            delivery_status: 'delivered',
          }),
        });
        return linhas?.[0] ?? null;
      } catch (erro) {
        if (/duplicate key|23505/.test(erro.message)) {
          logger.info('reentrega do provedor ignorada', {
            external_message_id: normalizada.external_message_id,
          });
          return null;
        }
        throw erro;
      }
    },

    /** Ultima mensagem do contato — insumo da janela de 24h do WhatsApp. */
    async ultimaMensagemDoContato(conversaId) {
      const linhas = await chamar(
        `messages?conversation_id=eq.${conversaId}&direction=eq.inbound&select=created_at&order=created_at.desc&limit=1`
      );
      return linhas?.[0]?.created_at ?? null;
    },

    async registrarEventoDeQualidade(channelAccountId, tipo, detalhe) {
      return chamar('channel_quality_events', {
        method: 'POST',
        body: JSON.stringify({ channel_account_id: channelAccountId, event_type: tipo, detail: detalhe }),
      });
    },
  };
}
