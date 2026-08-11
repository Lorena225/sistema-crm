'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import {
  ROTULO_ENTIDADE,
  TABELA_POR_ENTIDADE,
  TITULO_POR_ENTIDADE,
  type EntityKind,
} from '@/lib/crm/tipos';

/**
 * Quadro do pipeline.
 *
 * Arrastar usa a API nativa de drag and drop do navegador, sem biblioteca:
 * são três eventos (dragStart, dragOver, drop) e o comportamento fica
 * previsível. O que o card leva consigo é apenas o id do item.
 *
 * Ao soltar, a tela grava stage_id e position_in_stage. Não escreve histórico:
 * quem faz isso é o gatilho do banco, para que uma automação ou um agente que
 * mova o mesmo card no futuro produza exatamente o mesmo registro.
 */

interface Estagio {
  id: string;
  name: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
  probability: number | null;
  wip_limit: number | null;
}

interface Item {
  id: string;
  stage_id: string;
  entity_kind: EntityKind;
  entity_id: string;
  position_in_stage: number;
  entered_stage_at: string;
  rotulo?: string;
}

function desdeQuando(iso: string): string {
  const segundos = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (segundos < 60) return 'agora';
  if (segundos < 3600) return `${Math.floor(segundos / 60)} min`;
  if (segundos < 86400) return `${Math.floor(segundos / 3600)} h`;
  return `${Math.floor(segundos / 86400)} d`;
}

export default function QuadroPipeline({ params }: { params: { slug: string; id: string } }) {
  const supabase = createClient();

  const [pipeline, setPipeline] = useState<{ name: string; entity_kind: EntityKind } | null>(null);
  const [estagios, setEstagios] = useState<Estagio[]>([]);
  const [itens, setItens] = useState<Item[]>([]);
  const [candidatos, setCandidatos] = useState<{ id: string; rotulo: string }[]>([]);
  const [selecionado, setSelecionado] = useState('');
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [historico, setHistorico] = useState<any[]>([]);
  const [itemAberto, setItemAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const { data: pipe } = await supabase
      .from('pipelines').select('name, entity_kind, workspace_id').eq('id', params.id).maybeSingle();
    if (!pipe) return;
    setPipeline({ name: pipe.name, entity_kind: pipe.entity_kind });

    const [{ data: cols }, { data: cards }] = await Promise.all([
      supabase.from('pipeline_stages').select('*').eq('pipeline_id', params.id).order('position'),
      supabase.from('pipeline_items').select('*').eq('pipeline_id', params.id)
        .order('position_in_stage'),
    ]);

    setEstagios((cols ?? []) as Estagio[]);

    // Busca o rótulo de cada entidade na tabela correspondente.
    const tabela = TABELA_POR_ENTIDADE[pipe.entity_kind as EntityKind];
    const coluna = TITULO_POR_ENTIDADE[pipe.entity_kind as EntityKind];
    const { data: entidades } = await supabase.from(tabela).select(`id, ${coluna}`);
    const nomes = new Map((entidades ?? []).map((e: any) => [e.id, e[coluna]]));

    setItens(((cards ?? []) as Item[]).map((c) => ({ ...c, rotulo: nomes.get(c.entity_id) ?? '—' })));

    const jaNoQuadro = new Set((cards ?? []).map((c: any) => c.entity_id));
    setCandidatos(
      (entidades ?? [])
        .filter((e: any) => !jaNoQuadro.has(e.id))
        .map((e: any) => ({ id: e.id, rotulo: e[coluna] }))
    );
  }, [params.id, supabase]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function adicionar() {
    if (!selecionado || estagios.length === 0 || !pipeline) return;
    setErro('');

    const primeiro = estagios[0];
    const posicao = itens.filter((i) => i.stage_id === primeiro.id).length;

    const { error } = await supabase.from('pipeline_items').insert({
      pipeline_id: params.id,
      stage_id: primeiro.id,
      entity_kind: pipeline.entity_kind,
      entity_id: selecionado,
      position_in_stage: posicao,
    });

    if (error) { setErro(error.message); return; }
    setSelecionado('');
    await carregar();
  }

  async function soltar(estagioId: string) {
    setAlvo(null);
    if (!arrastando) return;

    const item = itens.find((i) => i.id === arrastando);
    setArrastando(null);
    if (!item || item.stage_id === estagioId) return;

    const posicao = itens.filter((i) => i.stage_id === estagioId).length;

    // Atualização otimista: o card muda de coluna na hora. Se o banco recusar,
    // o recarregamento devolve o estado real.
    setItens((atual) =>
      atual.map((i) => (i.id === item.id ? { ...i, stage_id: estagioId, position_in_stage: posicao } : i))
    );

    const { error } = await supabase.from('pipeline_items')
      .update({ stage_id: estagioId, position_in_stage: posicao })
      .eq('id', item.id);

    if (error) setErro(error.message);
    await carregar();
  }

  async function abrirHistorico(itemId: string) {
    if (itemAberto === itemId) { setItemAberto(null); return; }
    const { data } = await supabase
      .from('pipeline_stage_history')
      .select('from_stage_id, to_stage_id, moved_at, duration_seconds')
      .eq('pipeline_item_id', itemId)
      .order('moved_at');
    setHistorico(data ?? []);
    setItemAberto(itemId);
  }

  const nomeEstagio = (id: string | null) =>
    id ? estagios.find((e) => e.id === id)?.name ?? '—' : 'entrada';

  return (
    <main>
      <p className="eyebrow">
        <Link href={`/w/${params.slug}/pipelines`}>Pipelines</Link>
      </p>
      <h1>{pipeline?.name ?? 'Carregando…'}</h1>

      <div className="form-linha" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          <span>Adicionar ao quadro</span>
          <select value={selecionado} onChange={(e) => setSelecionado(e.target.value)}>
            <option value="">
              {candidatos.length > 0
                ? `${ROTULO_ENTIDADE[pipeline?.entity_kind ?? 'deal']}…`
                : 'Nada disponível'}
            </option>
            {candidatos.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
          </select>
        </label>
        <button onClick={adicionar} disabled={!selecionado}>Adicionar</button>
      </div>

      {erro && <p className="error">{erro}</p>}

      <div className="quadro">
        {estagios.map((estagio) => {
          const cards = itens.filter((i) => i.stage_id === estagio.id);
          const estourou = estagio.wip_limit !== null && cards.length > estagio.wip_limit;

          return (
            <section
              key={estagio.id}
              className={`coluna ${alvo === estagio.id ? 'coluna-alvo' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setAlvo(estagio.id); }}
              onDragLeave={() => setAlvo(null)}
              onDrop={() => soltar(estagio.id)}
            >
              <header className="coluna-topo">
                <h3>
                  {estagio.name}
                  {estagio.is_won && <span className="etiqueta ganho">ganho</span>}
                  {estagio.is_lost && <span className="etiqueta perda">perda</span>}
                </h3>
                <span className={`contador ${estourou ? 'estourou' : ''}`}>
                  {cards.length}{estagio.wip_limit ? ` / ${estagio.wip_limit}` : ''}
                </span>
              </header>

              {cards.length === 0 && <p className="coluna-vazia">Solte um card aqui</p>}

              {cards.map((item) => (
                <article
                  key={item.id}
                  className="card-quadro"
                  draggable
                  onDragStart={() => setArrastando(item.id)}
                  onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                >
                  <p className="card-quadro-titulo">{item.rotulo}</p>
                  <div className="meta">
                    <span>há {desdeQuando(item.entered_stage_at)}</span>
                    <button className="link" onClick={() => abrirHistorico(item.id)}>
                      {itemAberto === item.id ? 'fechar' : 'histórico'}
                    </button>
                  </div>

                  {itemAberto === item.id && (
                    <ul className="historico">
                      {historico.map((h, i) => (
                        <li key={i}>
                          {nomeEstagio(h.from_stage_id)} → {nomeEstagio(h.to_stage_id)}
                          {h.duration_seconds !== null && (
                            <span className="muted"> · {h.duration_seconds}s no anterior</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        Arraste um card entre colunas. Cada movimento grava origem, destino e tempo no estágio
        anterior — o registro é feito pelo banco, não por esta tela.
      </p>
    </main>
  );
}
