'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ROTULO_ENTIDADE, type EntityKind } from '@/lib/crm/tipos';

interface Pipeline {
  id: string;
  name: string;
  entity_kind: EntityKind;
  object_type_id: string | null;
  is_default: boolean;
}

const ESTAGIOS_INICIAIS = ['Novo', 'Em contato', 'Proposta', 'Ganho', 'Perdido'];

export default function PipelinesPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [tiposObjeto, setTiposObjeto] = useState<{ id: string; name: string }[]>([]);
  const [nome, setNome] = useState('');
  const [kind, setKind] = useState<EntityKind>('deal');
  const [tipoObjeto, setTipoObjeto] = useState('');
  const [padrao, setPadrao] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase
      .from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: pipes }, { data: tipos }, { data: itens }] = await Promise.all([
      supabase.from('pipelines').select('id, name, entity_kind, object_type_id, is_default').order('name'),
      supabase.from('object_types').select('id, name').order('name'),
      supabase.from('pipeline_items').select('pipeline_id'),
    ]);

    setPipelines((pipes ?? []) as Pipeline[]);
    setTiposObjeto(tipos ?? []);

    const totais: Record<string, number> = {};
    for (const i of itens ?? []) totais[i.pipeline_id] = (totais[i.pipeline_id] ?? 0) + 1;
    setContagem(totais);
  }, [params.slug, supabase]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    setErro('');

    const { data: pipe, error } = await supabase.from('pipelines').insert({
      workspace_id: workspaceId,
      name: nome.trim(),
      entity_kind: kind,
      object_type_id: kind === 'object_type' ? tipoObjeto : null,
      is_default: padrao,
    }).select('id').single();

    if (error) { setErro(error.message); return; }

    // Um pipeline sem estágios não serve para nada, então já nasce com uma
    // sequência editável em vez de um quadro vazio.
    const estagios = ESTAGIOS_INICIAIS.map((n, i) => ({
      pipeline_id: pipe.id,
      name: n,
      position: i,
      is_won: n === 'Ganho',
      is_lost: n === 'Perdido',
    }));

    const { error: erroEstagios } = await supabase.from('pipeline_stages').insert(estagios);
    if (erroEstagios) { setErro(erroEstagios.message); return; }

    setNome(''); setPadrao(false);
    await carregar();
  }

  async function remover(id: string) {
    const { error } = await supabase.from('pipelines').delete().eq('id', id);
    if (error) { setErro(error.message); return; }
    await carregar();
  }

  return (
    <main>
      <h1>Pipelines</h1>
      <p className="lede">
        Um registro pode percorrer vários pipelines ao mesmo tempo — vendas e implantação, por
        exemplo — porque o vínculo fica no item, não numa coluna de estágio dentro do cadastro.
      </p>

      <div className="painel">
        <h2>Novo pipeline</h2>
        <div className="form-linha">
          <label className="field">
            <span>Nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Vendas" />
          </label>

          <label className="field">
            <span>Move o quê</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as EntityKind)}>
              {(Object.keys(ROTULO_ENTIDADE) as EntityKind[]).map((k) => (
                <option key={k} value={k}>{ROTULO_ENTIDADE[k]}</option>
              ))}
            </select>
          </label>

          {kind === 'object_type' && (
            <label className="field">
              <span>Tipo de objeto</span>
              <select value={tipoObjeto} onChange={(e) => setTipoObjeto(e.target.value)}>
                <option value="">Escolha…</option>
                {tiposObjeto.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}

          <div className="field marcadores">
            <label className="marcador">
              <input type="checkbox" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
              Padrão para este tipo
            </label>
          </div>
        </div>

        <div className="acoes">
          <button
            onClick={criar}
            disabled={!nome.trim() || !workspaceId || (kind === 'object_type' && !tipoObjeto)}
          >
            Criar pipeline
          </button>
        </div>
        <p className="muted">
          Ele nasce com {ESTAGIOS_INICIAIS.length} estágios editáveis: {ESTAGIOS_INICIAIS.join(' · ')}.
        </p>
        {erro && <p className="error">{erro}</p>}
      </div>

      {pipelines.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nenhum pipeline ainda.</p></div>
      ) : (
        <ul className="card-list">
          {pipelines.map((p) => (
            <li key={p.id} className="card">
              <span className="card-slug">{ROTULO_ENTIDADE[p.entity_kind]}</span>
              <p className="card-name">
                <Link href={`/w/${params.slug}/pipelines/${p.id}`}>{p.name}</Link>
              </p>
              <div className="meta">
                <span>{contagem[p.id] ?? 0} card(s)</span>
                {p.is_default && <span>padrão</span>}
                <button className="link perigo" onClick={() => remover(p.id)}>remover</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
