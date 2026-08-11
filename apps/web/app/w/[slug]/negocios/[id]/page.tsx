'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CartaoNegocio } from '@/components/negocio/cartao-negocio';

/** Detalhe do negócio. O cartão é o mesmo componente que o cockpit vai usar. */
export default function NegocioPage({ params }: { params: { slug: string; id: string } }) {
  const supabase = createClient();
  const [tarefas, setTarefas] = useState<any[]>([]);
  const [campanhas, setCampanhas] = useState<any[]>([]);

  async function carregar() {
    const [{ data: t }, { data: ci }] = await Promise.all([
      supabase.from('tasks').select('id, title, due_at, status')
        .eq('related_to_type', 'deal').eq('related_to_id', params.id).order('due_at'),
      supabase.from('campaign_influence')
        .select('influence_type, weight, campaigns(name)').eq('deal_id', params.id),
    ]);
    setTarefas(t ?? []);
    setCampanhas(ci ?? []);
  }

  useEffect(() => { void carregar(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main>
      <p className="eyebrow">
        <Link href={`/w/${params.slug}/registros/deal`}>Negócios</Link>
      </p>

      <CartaoNegocio dealId={params.id} aoMudar={carregar} />

      <h2>Tarefas ligadas</h2>
      {tarefas.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nenhuma tarefa ligada a este negócio.</p></div>
      ) : (
        <ul className="card-list">
          {tarefas.map((t) => (
            <li key={t.id} className="card">
              <p className="card-name" style={{ marginTop: 0 }}>{t.title}</p>
              <div className="meta">
                <span>{t.status}</span>
                {t.due_at && <span>{new Date(t.due_at).toLocaleString('pt-BR')}</span>}
                {t.due_at && t.status === 'pendente' && new Date(t.due_at) < new Date() && (
                  <span className="etiqueta alerta">atrasada</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {campanhas.length > 0 && (
        <>
          <h2>Influência de campanha</h2>
          <div className="etiquetas">
            {campanhas.map((c, i) => (
              <span key={i} className="etiqueta">
                {(c.campaigns as any)?.name} · {c.influence_type} · peso {c.weight}
              </span>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
