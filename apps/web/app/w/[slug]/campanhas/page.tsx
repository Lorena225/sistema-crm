'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatarBRL } from '@/lib/crm/tipos';

/**
 * Campanhas e fila de duplicidades.
 *
 * A fila é revisável de propósito: fusão errada de contatos é irreversível na
 * prática, porque o histórico dos dois lados já se misturou. Nesta etapa a
 * revisão marca a decisão; a execução da fusão pertence a etapa posterior.
 */
export default function CampanhasPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [campanhas, setCampanhas] = useState<any[]>([]);
  const [membros, setMembros] = useState<any[]>([]);
  const [contatos, setContatos] = useState<any[]>([]);
  const [fila, setFila] = useState<any[]>([]);
  const [ativa, setAtiva] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const [nova, setNova] = useState({ name: '', channel: '', type: 'pago', budget: '', utm_source: '', utm_campaign: '' });
  const [novoMembro, setNovoMembro] = useState({ contact_id: '', status: 'alvo' });

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase.from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: c }, { data: m }, { data: ct }, { data: f }] = await Promise.all([
      supabase.from('campaigns').select('*').order('name'),
      supabase.from('campaign_members').select('*'),
      supabase.from('contacts').select('id, name, email, phone').order('name'),
      supabase.from('identity_merge_queue').select('*').order('confidence_score', { ascending: false }),
    ]);

    setCampanhas(c ?? []);
    setMembros(m ?? []);
    setContatos(ct ?? []);
    setFila(f ?? []);
    if (!ativa && c?.length) setAtiva(c[0].id);
  }, [params.slug, supabase, ativa]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    setErro('');
    const { error } = await supabase.from('campaigns').insert({
      workspace_id: workspaceId,
      name: nova.name,
      channel: nova.channel || null,
      type: nova.type,
      budget: nova.budget === '' ? null : Number(nova.budget),
      utm_source: nova.utm_source || null,
      utm_campaign: nova.utm_campaign || null,
    });
    if (error) { setErro(error.message); return; }
    setNova({ name: '', channel: '', type: 'pago', budget: '', utm_source: '', utm_campaign: '' });
    await carregar();
  }

  async function adicionarMembro() {
    setErro('');
    const { error } = await supabase.from('campaign_members')
      .insert({ campaign_id: ativa, contact_id: novoMembro.contact_id, status: novoMembro.status });
    if (error) { setErro(error.message); return; }
    setNovoMembro({ contact_id: '', status: 'alvo' });
    await carregar();
  }

  async function procurarDuplicatas() {
    setErro(''); setAviso('');
    let encontradas = 0;
    for (const c of contatos) {
      const { data, error } = await supabase.rpc('detect_duplicate_contacts', {
        p_workspace_id: workspaceId, p_contact_id: c.id,
      });
      if (error) { setErro(error.message); return; }
      encontradas += data ?? 0;
    }
    setAviso(`Varredura concluída: ${encontradas} candidato(s) avaliado(s).`);
    await carregar();
  }

  async function decidir(id: string, status: 'auto_merged' | 'rejected') {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('identity_merge_queue')
      .update({ status, reviewed_by: user?.id ?? null }).eq('id', id);
    if (error) { setErro(error.message); return; }
    await carregar();
  }

  const nome = (id: string) => contatos.find((c) => c.id === id)?.name ?? '—';
  const pendentes = fila.filter((f) => f.status === 'pending_review');

  return (
    <main>
      <h1>Campanhas e identidade</h1>

      <div className="painel">
        <h2>Nova campanha</h2>
        <div className="form-linha">
          <label className="field"><span>Nome</span>
            <input value={nova.name} onChange={(e) => setNova({ ...nova, name: e.target.value })} /></label>
          <label className="field"><span>Canal</span>
            <input value={nova.channel} onChange={(e) => setNova({ ...nova, channel: e.target.value })}
              placeholder="meta, google, evento" /></label>
          <label className="field"><span>Tipo</span>
            <select value={nova.type} onChange={(e) => setNova({ ...nova, type: e.target.value })}>
              <option value="pago">pago</option><option value="organico">orgânico</option><option value="offline">offline</option>
            </select></label>
          <label className="field"><span>Orçamento (BRL)</span>
            <input type="number" step="0.01" value={nova.budget}
              onChange={(e) => setNova({ ...nova, budget: e.target.value })} /></label>
        </div>
        <div className="form-linha">
          <label className="field"><span>utm_source</span>
            <input value={nova.utm_source} onChange={(e) => setNova({ ...nova, utm_source: e.target.value })} /></label>
          <label className="field"><span>utm_campaign</span>
            <input value={nova.utm_campaign} onChange={(e) => setNova({ ...nova, utm_campaign: e.target.value })} /></label>
        </div>
        <div className="acoes">
          <button onClick={criar} disabled={!nova.name || !workspaceId}>Criar campanha</button>
        </div>
        {erro && <p className="error">{erro}</p>}
      </div>

      {campanhas.length > 0 && (
        <>
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead><tr><th>Campanha</th><th>Canal</th><th>Tipo</th><th>Orçamento</th><th>Membros</th></tr></thead>
              <tbody>
                {campanhas.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td><td>{c.channel ?? '—'}</td><td>{c.type}</td>
                    <td>{formatarBRL(c.budget)}</td>
                    <td>{membros.filter((m) => m.campaign_id === c.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Público da campanha</h2>
          <div className="inline-form">
            <select value={ativa} onChange={(e) => setAtiva(e.target.value)}>
              {campanhas.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={novoMembro.contact_id}
              onChange={(e) => setNovoMembro({ ...novoMembro, contact_id: e.target.value })}>
              <option value="">Contato…</option>
              {contatos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={novoMembro.status}
              onChange={(e) => setNovoMembro({ ...novoMembro, status: e.target.value })}>
              <option value="alvo">alvo</option><option value="respondeu">respondeu</option>
              <option value="convertido">convertido</option>
            </select>
            <button onClick={adicionarMembro} disabled={!novoMembro.contact_id || !ativa}>Adicionar</button>
          </div>

          <div className="etiquetas" style={{ marginTop: '0.75rem' }}>
            {membros.filter((m) => m.campaign_id === ativa).map((m) => (
              <span key={m.id} className="etiqueta">{nome(m.contact_id)} · {m.status}</span>
            ))}
          </div>
        </>
      )}

      <h2>Duplicidades para revisar</h2>
      <p className="muted">
        Comparação por documento, e-mail e telefone. Nada é fundido sozinho: a fusão mistura o
        histórico dos dois cadastros e, na prática, não tem volta.
      </p>

      <div className="inline-form">
        <button onClick={procurarDuplicatas} disabled={!workspaceId || contatos.length === 0}>
          Procurar duplicidades
        </button>
      </div>
      {aviso && <p className="notice">{aviso}</p>}

      {pendentes.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nada pendente de revisão.</p></div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Candidato</th><th>Já cadastrado</th><th>Confiança</th><th /></tr></thead>
            <tbody>
              {pendentes.map((f) => (
                <tr key={f.id}>
                  <td>{nome(f.candidate_contact_id)}</td>
                  <td>{nome(f.existing_contact_id)}</td>
                  <td className="mono">{Math.round(Number(f.confidence_score) * 100)}%</td>
                  <td className="acoes-linha">
                    <button className="link" onClick={() => decidir(f.id, 'auto_merged')}>é a mesma pessoa</button>
                    <button className="link perigo" onClick={() => decidir(f.id, 'rejected')}>são diferentes</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
