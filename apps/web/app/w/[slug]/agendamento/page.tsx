'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** Páginas públicas de agendamento e suas janelas de disponibilidade. */
export default function AgendamentoPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [paginas, setPaginas] = useState<any[]>([]);
  const [janelas, setJanelas] = useState<any[]>([]);
  const [tipos, setTipos] = useState<any[]>([]);
  const [ativa, setAtiva] = useState('');
  const [erro, setErro] = useState('');
  const [origem, setOrigem] = useState('');

  const [nova, setNova] = useState({
    slug: '', title: '', default_duration_minutes: '30', buffer_between_meetings: '15', task_type_id: '',
  });
  const [novaJanela, setNovaJanela] = useState({ modo: 'semanal', day_of_week: '1', date: '', start_time: '09:00', end_time: '12:00' });

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase.from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);
    setOrigem(window.location.origin);

    const [{ data: p }, { data: s }, { data: t }] = await Promise.all([
      supabase.from('booking_pages').select('*').order('title'),
      supabase.from('booking_slots').select('*'),
      supabase.from('task_types').select('id, name').order('name'),
    ]);

    setPaginas(p ?? []);
    setJanelas(s ?? []);
    setTipos(t ?? []);
    if (!ativa && p?.length) setAtiva(p[0].id);
  }, [params.slug, supabase, ativa]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criarPagina() {
    setErro('');
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('booking_pages').insert({
      workspace_id: workspaceId,
      user_id: user?.id ?? null,
      slug: nova.slug,
      title: nova.title,
      default_duration_minutes: Number(nova.default_duration_minutes),
      buffer_between_meetings: Number(nova.buffer_between_meetings),
      task_type_id: nova.task_type_id || null,
    });
    if (error) { setErro(error.message); return; }
    setNova({ slug: '', title: '', default_duration_minutes: '30', buffer_between_meetings: '15', task_type_id: '' });
    await carregar();
  }

  async function criarJanela() {
    setErro('');
    const { error } = await supabase.from('booking_slots').insert({
      booking_page_id: ativa,
      day_of_week: novaJanela.modo === 'semanal' ? Number(novaJanela.day_of_week) : null,
      date: novaJanela.modo === 'data' ? novaJanela.date : null,
      start_time: novaJanela.start_time,
      end_time: novaJanela.end_time,
    });
    if (error) { setErro(error.message); return; }
    await carregar();
  }

  async function removerJanela(id: string) {
    await supabase.from('booking_slots').delete().eq('id', id);
    await carregar();
  }

  const paginaAtiva = paginas.find((p) => p.id === ativa);

  return (
    <main>
      <h1>Agendamento</h1>
      <p className="lede">
        Uma página pública por link. Quem agenda não precisa de conta, e cada reserva vira tarefa
        com a origem registrada.
      </p>

      <div className="painel">
        <h2>Nova página</h2>
        <div className="form-linha">
          <label className="field"><span>Endereço (slug)</span>
            <input value={nova.slug}
              onChange={(e) => setNova({ ...nova, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="lorena-reuniao" /></label>
          <label className="field"><span>Título</span>
            <input value={nova.title} onChange={(e) => setNova({ ...nova, title: e.target.value })}
              placeholder="Reunião de diagnóstico" /></label>
          <label className="field campo-curto"><span>Duração (min)</span>
            <input type="number" value={nova.default_duration_minutes}
              onChange={(e) => setNova({ ...nova, default_duration_minutes: e.target.value })} /></label>
          <label className="field campo-curto"><span>Intervalo (min)</span>
            <input type="number" value={nova.buffer_between_meetings}
              onChange={(e) => setNova({ ...nova, buffer_between_meetings: e.target.value })} /></label>
          <label className="field"><span>Tipo de tarefa</span>
            <select value={nova.task_type_id} onChange={(e) => setNova({ ...nova, task_type_id: e.target.value })}>
              <option value="">—</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select></label>
        </div>
        <div className="acoes">
          <button onClick={criarPagina} disabled={!nova.slug || !nova.title || !workspaceId}>Criar página</button>
        </div>
        {erro && <p className="error">{erro}</p>}
      </div>

      {paginas.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nenhuma página de agendamento ainda.</p></div>
      ) : (
        <>
          <div className="form-linha">
            <label className="field"><span>Página</span>
              <select value={ativa} onChange={(e) => setAtiva(e.target.value)}>
                {paginas.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select></label>
          </div>

          {paginaAtiva && (
            <p className="muted">
              Link público: <span className="mono">{origem}/agendar/{paginaAtiva.slug}</span> ·
              {' '}{paginaAtiva.default_duration_minutes} min com {paginaAtiva.buffer_between_meetings} min de intervalo
            </p>
          )}

          <h2>Janelas disponíveis</h2>
          <div className="inline-form">
            <select value={novaJanela.modo} onChange={(e) => setNovaJanela({ ...novaJanela, modo: e.target.value })}>
              <option value="semanal">Toda semana</option>
              <option value="data">Data específica</option>
            </select>
            {novaJanela.modo === 'semanal' ? (
              <select value={novaJanela.day_of_week}
                onChange={(e) => setNovaJanela({ ...novaJanela, day_of_week: e.target.value })}>
                {DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            ) : (
              <input type="date" value={novaJanela.date}
                onChange={(e) => setNovaJanela({ ...novaJanela, date: e.target.value })} />
            )}
            <input type="time" value={novaJanela.start_time}
              onChange={(e) => setNovaJanela({ ...novaJanela, start_time: e.target.value })} />
            <input type="time" value={novaJanela.end_time}
              onChange={(e) => setNovaJanela({ ...novaJanela, end_time: e.target.value })} />
            <button onClick={criarJanela} disabled={!ativa}>Adicionar janela</button>
          </div>

          <div className="etiquetas" style={{ marginTop: '0.75rem' }}>
            {janelas.filter((j) => j.booking_page_id === ativa).map((j) => (
              <span key={j.id} className="etiqueta">
                {j.day_of_week !== null ? DIAS[j.day_of_week] : new Date(j.date + 'T12:00').toLocaleDateString('pt-BR')}
                {' '}{String(j.start_time).slice(0, 5)}–{String(j.end_time).slice(0, 5)}
                {' '}<button className="link perigo" onClick={() => removerJanela(j.id)}>×</button>
              </span>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
