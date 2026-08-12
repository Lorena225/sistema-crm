'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Tarefas do workspace.
 *
 * "Atrasada" não é um status guardado: é `due_at < agora` com status
 * pendente, calculado na hora de exibir. Persistir isso exigiria um job
 * varrendo a tabela, e entre duas varreduras a tela mostraria o passado.
 */

const PRIORIDADES = ['baixa', 'média', 'alta', 'urgente'];
const STATUS = ['pendente', 'em_andamento', 'concluída', 'cancelada'];
const CATEGORIAS = ['ligação', 'reunião', 'visita', 'e-mail', 'follow_up', 'administrativa', 'entrega', 'outro'];

interface Tarefa {
  id: string; title: string; description: string | null; task_type_id: string | null;
  due_at: string | null; priority: string; status: string; source: string;
  outcome_type_id: string | null; outcome_notes: string | null;
  related_to_type: string | null; related_to_id: string | null;
}

export default function TarefasPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [tipos, setTipos] = useState<any[]>([]);
  const [resultados, setResultados] = useState<any[]>([]);
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [comentarios, setComentarios] = useState<Record<string, any[]>>({});
  const [aberta, setAberta] = useState<string | null>(null);
  const [novoComentario, setNovoComentario] = useState('');
  const [filtro, setFiltro] = useState<'todas' | 'atrasadas' | 'abertas'>('abertas');
  const [erro, setErro] = useState('');

  const [nova, setNova] = useState({ title: '', task_type_id: '', due_at: '', priority: 'média', description: '' });
  const [novoTipo, setNovoTipo] = useState({ code: '', name: '', category: 'ligação', requires_outcome: false });

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase.from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: tt }, { data: ot }, { data: ts }] = await Promise.all([
      supabase.from('task_types').select('*').order('name'),
      supabase.from('task_outcome_types').select('*'),
      supabase.from('tasks').select('*').order('due_at', { nullsFirst: false }),
    ]);

    setTipos(tt ?? []);
    setResultados(ot ?? []);
    setTarefas((ts ?? []) as Tarefa[]);
  }, [params.slug, supabase]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criarTipo() {
    setErro('');
    const { error } = await supabase.from('task_types').insert({
      workspace_id: workspaceId,
      code: novoTipo.code,
      name: novoTipo.name,
      category: novoTipo.category,
      requires_outcome: novoTipo.requires_outcome,
    });
    if (error) { setErro(error.message); return; }
    setNovoTipo({ code: '', name: '', category: 'ligação', requires_outcome: false });
    await carregar();
  }

  async function criar() {
    setErro('');
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from('tasks').insert({
      workspace_id: workspaceId,
      title: nova.title,
      description: nova.description || null,
      task_type_id: nova.task_type_id || null,
      due_at: nova.due_at ? new Date(nova.due_at).toISOString() : null,
      priority: nova.priority,
      created_by: user?.id ?? null,
      assigned_to: user?.id ?? null,
      source: 'manual',
    });

    if (error) { setErro(error.message); return; }
    setNova({ title: '', task_type_id: '', due_at: '', priority: 'média', description: '' });
    await carregar();
  }

  async function concluir(tarefa: Tarefa, outcomeId: string) {
    const tipo = tipos.find((t) => t.id === tarefa.task_type_id);
    if (tipo?.requires_outcome && !outcomeId) {
      setErro(`O tipo "${tipo.name}" exige registrar o resultado antes de concluir.`);
      return;
    }
    setErro('');

    const { error } = await supabase.from('tasks').update({
      status: 'concluída',
      completed_at: new Date().toISOString(),
      outcome_type_id: outcomeId || null,
    }).eq('id', tarefa.id);

    if (error) { setErro(error.message); return; }
    await carregar();
  }

  async function abrirComentarios(id: string) {
    if (aberta === id) { setAberta(null); return; }
    const { data } = await supabase.from('task_comments')
      .select('id, body, created_at').eq('task_id', id).order('created_at');
    setComentarios({ ...comentarios, [id]: data ?? [] });
    setAberta(id);
  }

  async function comentar(taskId: string) {
    if (!novoComentario.trim()) return;
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('task_comments')
      .insert({ task_id: taskId, author_id: user?.id ?? null, body: novoComentario.trim() });
    if (error) { setErro(error.message); return; }
    setNovoComentario('');
    await abrirComentarios(taskId);
    setAberta(taskId);
  }

  const agora = Date.now();
  const estaAtrasada = (t: Tarefa) =>
    t.status === 'pendente' && t.due_at !== null && new Date(t.due_at).getTime() < agora;

  const visiveis = tarefas.filter((t) =>
    filtro === 'todas' ? true
    : filtro === 'atrasadas' ? estaAtrasada(t)
    : t.status === 'pendente' || t.status === 'em_andamento');

  return (
    <main>
      <h1>Tarefas</h1>
      <p className="lede">
        {tarefas.filter(estaAtrasada).length} atrasada(s) de {tarefas.length}. Atraso é calculado
        na hora — não existe status &ldquo;atrasada&rdquo; guardado no banco.
      </p>

      {tipos.length === 0 && (
        <div className="painel">
          <h2>Primeiro, um tipo de tarefa</h2>
          <p className="muted">
            O catálogo é global no workspace: um tipo &ldquo;ligação&rdquo; serve a qualquer funil
            ou equipe, sem vínculo com pipeline.
          </p>
          <div className="form-linha">
            <label className="field">
              <span>Código</span>
              <input value={novoTipo.code}
                onChange={(e) => setNovoTipo({ ...novoTipo, code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                placeholder="ligacao" />
            </label>
            <label className="field">
              <span>Nome</span>
              <input value={novoTipo.name} onChange={(e) => setNovoTipo({ ...novoTipo, name: e.target.value })}
                placeholder="Ligação de prospecção" />
            </label>
            <label className="field">
              <span>Categoria</span>
              <select value={novoTipo.category} onChange={(e) => setNovoTipo({ ...novoTipo, category: e.target.value })}>
                {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="field marcadores">
              <label className="marcador">
                <input type="checkbox" checked={novoTipo.requires_outcome}
                  onChange={(e) => setNovoTipo({ ...novoTipo, requires_outcome: e.target.checked })} />
                Exige resultado
              </label>
            </div>
          </div>
          <div className="acoes">
            <button onClick={criarTipo} disabled={!novoTipo.code || !novoTipo.name}>Criar tipo</button>
          </div>
        </div>
      )}

      <div className="painel">
        <h2>Nova tarefa</h2>
        <div className="form-linha">
          <label className="field">
            <span>Título</span>
            <input value={nova.title} onChange={(e) => setNova({ ...nova, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Tipo</span>
            <select value={nova.task_type_id} onChange={(e) => setNova({ ...nova, task_type_id: e.target.value })}>
              <option value="">—</option>
              {tipos.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Prazo</span>
            <input type="datetime-local" value={nova.due_at}
              onChange={(e) => setNova({ ...nova, due_at: e.target.value })} />
          </label>
          <label className="field">
            <span>Prioridade</span>
            <select value={nova.priority} onChange={(e) => setNova({ ...nova, priority: e.target.value })}>
              {PRIORIDADES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>
        <div className="acoes">
          <button onClick={criar} disabled={!nova.title || !workspaceId}>Criar tarefa</button>
        </div>
        {erro && <p className="error">{erro}</p>}
      </div>

      <div className="inline-form" style={{ marginBottom: '1rem' }}>
        {(['abertas', 'atrasadas', 'todas'] as const).map((f) => (
          <button key={f} className={filtro === f ? '' : 'secundario'} onClick={() => setFiltro(f)}>
            {f}
          </button>
        ))}
      </div>

      {visiveis.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nada aqui com este filtro.</p></div>
      ) : (
        <ul className="card-list">
          {visiveis.map((t) => {
            const tipo = tipos.find((x) => x.id === t.task_type_id);
            const opcoes = resultados.filter((o) => o.task_type_id === t.task_type_id);
            return (
              <li key={t.id} className="card">
                <p className="card-name" style={{ marginTop: 0 }}>{t.title}</p>
                <div className="meta">
                  {tipo && <span>{tipo.name}</span>}
                  <span>{t.priority}</span>
                  <span>{t.status}</span>
                  {t.source !== 'manual' && <span>{t.source}</span>}
                  {t.due_at && <span>{new Date(t.due_at).toLocaleString('pt-BR')}</span>}
                  {estaAtrasada(t) && <span className="etiqueta alerta">atrasada</span>}
                </div>

                <div className="inline-form" style={{ marginTop: '0.5rem' }}>
                  {t.status !== 'concluída' && (
                    opcoes.length > 0 ? (
                      <select defaultValue="" onChange={(e) => concluir(t, e.target.value)}>
                        <option value="">Concluir com resultado…</option>
                        {opcoes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    ) : (
                      <button onClick={() => concluir(t, '')}>Concluir</button>
                    )
                  )}
                  <button className="link" onClick={() => abrirComentarios(t.id)}>
                    {aberta === t.id ? 'fechar' : 'comentários'}
                  </button>
                </div>

                {aberta === t.id && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <ul className="historico">
                      {(comentarios[t.id] ?? []).map((c) => (
                        <li key={c.id}>
                          {c.body} <span className="muted">· {new Date(c.created_at).toLocaleString('pt-BR')}</span>
                        </li>
                      ))}
                      {(comentarios[t.id] ?? []).length === 0 && <li className="muted">Sem comentários.</li>}
                    </ul>
                    <div className="inline-form" style={{ marginTop: '0.4rem' }}>
                      <input value={novoComentario} onChange={(e) => setNovoComentario(e.target.value)}
                        placeholder="Escrever comentário" />
                      <button onClick={() => comentar(t.id)}>Comentar</button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
