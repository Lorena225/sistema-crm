'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatarBRL, paraTexto, type FieldDefinition } from '@/lib/crm/tipos';

/**
 * Cockpit de tres colunas: fila, conversa e cartao operacional.
 *
 * A ideia que sustenta a tela: o atendente nao sai do chat. Mudar estagio,
 * trocar responsavel, criar tarefa, criar nota, editar campo customizado e
 * mexer nos itens do negocio acontecem na terceira coluna, ao lado da
 * conversa — nao em outra aba, nao em outro sistema.
 *
 * Realtime vem do Supabase (Etapa 1 ja o deixou provisionado para presenca,
 * notificacao e evento). Ele nao e motor de BI: aqui serve so para o que
 * chega agora aparecer agora.
 */

type Registro = Record<string, any>;

const ROTULO_STATUS: Record<string, string> = {
  queued: 'na fila', sent: 'enviada', delivered: 'entregue', read: 'lida', failed: 'falhou',
};

function horario(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function CockpitPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [conversas, setConversas] = useState<Registro[]>([]);
  const [ativa, setAtiva] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Registro[]>([]);
  const [reacoes, setReacoes] = useState<Record<string, string[]>>({});
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const fimDaThread = useRef<HTMLDivElement>(null);

  // Cartão operacional
  const [contato, setContato] = useState<Registro | null>(null);
  const [negocio, setNegocio] = useState<Registro | null>(null);
  const [itens, setItens] = useState<Registro[]>([]);
  const [definicoes, setDefinicoes] = useState<FieldDefinition[]>([]);
  const [notas, setNotas] = useState<Registro[]>([]);
  const [membros, setMembros] = useState<Registro[]>([]);
  const [estagios, setEstagios] = useState<Registro[]>([]);
  const [itemPipeline, setItemPipeline] = useState<Registro | null>(null);
  const [novaNota, setNovaNota] = useState('');
  const [novaTarefa, setNovaTarefa] = useState('');

  const conversaAtiva = useMemo(
    () => conversas.find((c) => c.id === ativa) ?? null,
    [conversas, ativa]
  );

  const carregarConversas = useCallback(async () => {
    const { data: ws } = await supabase
      .from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const { data } = await supabase
      .from('conversations')
      .select('*, channel_accounts(channel_type, display_name), contacts(name, phone, email)')
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(50);

    setConversas(data ?? []);
    if (!ativa && data?.[0]) setAtiva(data[0].id);
  }, [ativa, params.slug, supabase]);

  const carregarThread = useCallback(async (conversaId: string) => {
    const [{ data: msgs }, { data: reacs }] = await Promise.all([
      supabase.from('messages').select('*').eq('conversation_id', conversaId)
        .order('created_at', { ascending: true }).limit(200),
      supabase.from('message_reactions').select('message_id, emoji'),
    ]);

    setMensagens(msgs ?? []);
    const mapa: Record<string, string[]> = {};
    for (const r of reacs ?? []) {
      (mapa[r.message_id] ??= []).push(r.emoji);
    }
    setReacoes(mapa);
  }, [supabase]);

  const carregarCartao = useCallback(async (conversa: Registro) => {
    if (!conversa) return;

    const [{ data: mem }, { data: defs }] = await Promise.all([
      supabase.from('workspace_members').select('user_id, role').eq('status', 'active'),
      supabase.from('field_definitions').select('*').eq('entity_kind', 'contact').order('position'),
    ]);
    setMembros(mem ?? []);
    setDefinicoes((defs ?? []) as FieldDefinition[]);

    if (conversa.contact_id) {
      const [{ data: ct }, { data: nt }] = await Promise.all([
        supabase.from('contacts').select('*').eq('id', conversa.contact_id).maybeSingle(),
        supabase.from('notes').select('*').eq('related_to_id', conversa.contact_id)
          .order('is_pinned', { ascending: false }).order('created_at', { ascending: false }),
      ]);
      setContato(ct); setNotas(nt ?? []);
    } else {
      setContato(null); setNotas([]);
    }

    if (conversa.deal_id) {
      const [{ data: dl }, { data: li }, { data: pi }] = await Promise.all([
        supabase.from('deals').select('*').eq('id', conversa.deal_id).maybeSingle(),
        supabase.from('deal_line_items').select('*, products(name)').eq('deal_id', conversa.deal_id),
        supabase.from('pipeline_items').select('*, pipelines(name)').eq('entity_id', conversa.deal_id).maybeSingle(),
      ]);
      setNegocio(dl); setItens(li ?? []); setItemPipeline(pi);

      if (pi) {
        const { data: st } = await supabase.from('pipeline_stages')
          .select('id, name, position').eq('pipeline_id', pi.pipeline_id).order('position');
        setEstagios(st ?? []);
      }
    } else {
      setNegocio(null); setItens([]); setItemPipeline(null); setEstagios([]);
    }
  }, [supabase]);

  useEffect(() => { void carregarConversas(); }, [carregarConversas]);

  useEffect(() => {
    if (!ativa) return;
    void carregarThread(ativa);
    const conversa = conversas.find((c) => c.id === ativa);
    if (conversa) void carregarCartao(conversa);
  }, [ativa, conversas, carregarThread, carregarCartao]);

  // Realtime: mensagem nova aparece sem recarregar.
  useEffect(() => {
    if (!ativa) return;
    const canal = supabase
      .channel(`conversa:${ativa}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${ativa}` },
        () => { void carregarThread(ativa); })
      .subscribe();

    return () => { void supabase.removeChannel(canal); };
  }, [ativa, carregarThread, supabase]);

  useEffect(() => {
    fimDaThread.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  async function enviar() {
    if (!texto.trim() || !ativa) return;
    setErro('');

    // sender_type = agent: o gatilho do banco desliga is_bot_active. A tela
    // nao precisa saber disso — e justamente esse o ponto.
    const { data: gravada, error } = await supabase.from('messages').insert({
      conversation_id: ativa,
      direction: 'outbound',
      sender_type: 'agent',
      content: texto.trim(),
      delivery_status: 'queued',
    }).select('id').single();

    if (error) { setErro(error.message); return; }

    // A mensagem ja esta gravada como `queued`. O envio real fica com o
    // worker, que aplica janela de 24h, teto por conta, retry e backoff — e
    // grava o status de volta. Se o worker estiver fora do ar, a mensagem
    // permanece na fila em vez de se perder.
    void fetch('/api/inbox/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensagemId: gravada.id,
        conversaId: ativa,
        canal: conversaAtiva?.channel_accounts?.channel_type,
        channelAccountId: conversaAtiva?.channel_account_id,
        destino: conversaAtiva?.contacts?.phone,
      }),
    }).catch(() => setAviso('Mensagem gravada; o envio será retomado quando o serviço voltar.'));
    setTexto('');
    await carregarThread(ativa);
    await carregarConversas();
  }

  async function mudarStatus(status: string) {
    if (!ativa) return;
    const { error } = await supabase.from('conversations').update({ status }).eq('id', ativa);
    if (error) { setErro(error.message); return; }
    if (status === 'resolved') setAviso('Conversa resolvida. O resumo segue a configuração do workspace.');
    await carregarConversas();
  }

  async function trocarResponsavel(userId: string) {
    if (!ativa) return;
    await supabase.from('conversations').update({ assigned_to: userId || null }).eq('id', ativa);
    await carregarConversas();
  }

  async function moverEstagio(stageId: string) {
    if (!itemPipeline) return;
    const { error } = await supabase.from('pipeline_items')
      .update({ stage_id: stageId }).eq('id', itemPipeline.id);
    if (error) { setErro(error.message); return; }
    setAviso('Estágio atualizado. O histórico foi registrado pelo banco.');
    if (conversaAtiva) await carregarCartao(conversaAtiva);
  }

  async function salvarCampo(chave: string, valor: string) {
    if (!contato) return;
    const atualizados = { ...(contato.custom_fields ?? {}), [chave]: valor };
    if (valor === '') delete atualizados[chave];
    const { error } = await supabase.from('contacts')
      .update({ custom_fields: atualizados }).eq('id', contato.id);
    if (error) { setErro(error.message); return; }
    setContato({ ...contato, custom_fields: atualizados });
    setAviso('Campo salvo.');
  }

  async function criarNota() {
    if (!novaNota.trim() || !contato) return;
    const { error } = await supabase.from('notes').insert({
      workspace_id: workspaceId, related_to_type: 'contact',
      related_to_id: contato.id, body: novaNota.trim(),
    });
    if (error) { setErro(error.message); return; }
    setNovaNota('');
    if (conversaAtiva) await carregarCartao(conversaAtiva);
  }

  async function criarTarefa() {
    if (!novaTarefa.trim() || !contato) return;
    const { error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId, title: novaTarefa.trim(),
      related_to_type: 'contact', related_to_id: contato.id,
      due_at: new Date(Date.now() + 86400000).toISOString(),
    });
    if (error) { setErro(error.message); return; }
    setNovaTarefa('');
    setAviso('Tarefa criada para amanhã.');
  }

  return (
    <main className="cockpit">
      {/* Coluna 1 — fila */}
      <aside className="coluna-fila">
        <p className="eyebrow">Conversas</p>
        {conversas.length === 0 && <p className="muted">Nenhuma conversa ainda.</p>}
        {conversas.map((c) => (
          <button
            key={c.id}
            className={`item-fila ${c.id === ativa ? 'ativa' : ''}`}
            onClick={() => setAtiva(c.id)}
          >
            <span className="item-fila-nome">{c.contacts?.name ?? 'Sem contato'}</span>
            <span className="meta">
              <span>{c.channel_accounts?.channel_type}</span>
              <span>{c.status}</span>
              {c.is_bot_active && <span className="etiqueta">bot</span>}
            </span>
          </button>
        ))}
      </aside>

      {/* Coluna 2 — thread */}
      <section className="coluna-thread">
        {!conversaAtiva ? (
          <p className="muted">Escolha uma conversa.</p>
        ) : (
          <>
            <header className="thread-topo">
              <div>
                <strong>{conversaAtiva.contacts?.name ?? 'Sem contato'}</strong>
                <span className="muted"> · {conversaAtiva.channel_accounts?.display_name}</span>
              </div>
              <div className="acoes">
                <button className="link" onClick={() => mudarStatus('pending')}>pendente</button>
                <button className="link" onClick={() => mudarStatus('resolved')}>resolver</button>
              </div>
            </header>

            <div className="thread">
              {mensagens.map((m) => (
                <article key={m.id} className={`balao ${m.direction}`}>
                  {m.media_type === 'audio' ? (
                    <div>
                      {m.media_url && <audio controls src={m.media_url} />}
                      <span className="muted"> {m.duration_seconds ?? '?'}s</span>
                      <p className="transcricao">
                        {m.transcript ?? 'Transcrição em processamento…'}
                      </p>
                    </div>
                  ) : (
                    <p className="balao-texto">{m.content}</p>
                  )}

                  <div className="meta">
                    <span>{horario(m.created_at)}</span>
                    <span>{m.sender_type}</span>
                    {m.direction === 'outbound' && (
                      <span className={m.delivery_status === 'failed' ? 'falhou' : ''}>
                        {ROTULO_STATUS[m.delivery_status] ?? m.delivery_status}
                      </span>
                    )}
                    {(reacoes[m.id] ?? []).map((e, i) => <span key={i}>{e}</span>)}
                  </div>

                  {m.error_reason && <p className="erro-entrega">{m.error_reason}</p>}
                </article>
              ))}
              <div ref={fimDaThread} />
            </div>

            <div className="composer">
              <input
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void enviar(); }}
                placeholder="Escreva uma resposta…"
              />
              <button onClick={enviar} disabled={!texto.trim()}>Enviar</button>
            </div>
            {conversaAtiva.is_bot_active && (
              <p className="muted">O bot está ativo. Sua primeira resposta o desliga.</p>
            )}
          </>
        )}
      </section>

      {/* Coluna 3 — cartão operacional */}
      <aside className="coluna-cartao">
        {erro && <p className="error">{erro}</p>}
        {aviso && <p className="notice">{aviso}</p>}

        {contato && (
          <>
            <p className="eyebrow">Contato</p>
            <p className="card-name">{contato.name}</p>
            <div className="meta"><span>{contato.phone ?? '—'}</span><span>{contato.email ?? '—'}</span></div>

            {definicoes.length > 0 && (
              <>
                <p className="eyebrow" style={{ marginTop: '1rem' }}>Campos</p>
                {definicoes.map((d) => (
                  <label key={d.id} className="field">
                    <span>{d.label}</span>
                    <input
                      defaultValue={paraTexto(d.field_type, contato.custom_fields?.[d.key]) === '—'
                        ? '' : String(contato.custom_fields?.[d.key] ?? '')}
                      onBlur={(e) => salvarCampo(d.key, e.target.value)}
                    />
                  </label>
                ))}
              </>
            )}
          </>
        )}

        <p className="eyebrow" style={{ marginTop: '1.25rem' }}>Atendimento</p>
        <label className="field">
          <span>Responsável</span>
          <select
            value={conversaAtiva?.assigned_to ?? ''}
            onChange={(e) => trocarResponsavel(e.target.value)}
          >
            <option value="">Ninguém</option>
            {membros.map((m) => <option key={m.user_id} value={m.user_id}>{m.role}</option>)}
          </select>
        </label>

        {itemPipeline && (
          <label className="field">
            <span>Estágio · {itemPipeline.pipelines?.name}</span>
            <select value={itemPipeline.stage_id} onChange={(e) => moverEstagio(e.target.value)}>
              {estagios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}

        {negocio && (
          <>
            <p className="eyebrow" style={{ marginTop: '1.25rem' }}>Negócio</p>
            <p className="card-name">{negocio.title}</p>
            <p className="valor-negocio">{formatarBRL(negocio.value, negocio.currency)}</p>

            {itens.length > 0 ? (
              <table className="tabela">
                <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Total</th></tr></thead>
                <tbody>
                  {itens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.products?.name}</td>
                      <td>{i.quantity}</td>
                      <td>{formatarBRL(i.unit_price)}</td>
                      <td>{formatarBRL(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Sem itens. O valor é editável na tela do negócio.</p>
            )}
          </>
        )}

        <p className="eyebrow" style={{ marginTop: '1.25rem' }}>Ações rápidas</p>
        <div className="inline-form">
          <input value={novaTarefa} onChange={(e) => setNovaTarefa(e.target.value)} placeholder="Nova tarefa" />
          <button onClick={criarTarefa} disabled={!novaTarefa.trim() || !contato}>Criar</button>
        </div>
        <div className="inline-form" style={{ marginTop: '0.5rem' }}>
          <input value={novaNota} onChange={(e) => setNovaNota(e.target.value)} placeholder="Nova nota" />
          <button onClick={criarNota} disabled={!novaNota.trim() || !contato}>Salvar</button>
        </div>

        {notas.length > 0 && (
          <ul className="lista-notas">
            {notas.map((n) => (
              <li key={n.id}>
                {n.is_pinned && <span className="etiqueta">fixada</span>} {n.body}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </main>
  );
}
