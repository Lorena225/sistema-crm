import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

type WorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
};

/**
 * Lista os workspaces do usuario autenticado.
 *
 * Nao ha filtro por workspace_id no codigo: a consulta e um SELECT amplo e o
 * recorte por tenant e feito pela politica RLS workspaces_select_member.
 * Se a RLS falhar, esta tela vaza dados — por isso ela serve tambem como
 * verificacao visual do isolamento.
 */
export default async function WorkspacesPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data, error } = await supabase
    .from('workspaces')
    .select('id, name, slug, plan, status, created_at')
    .order('created_at', { ascending: true });

  const workspaces = (data ?? []) as WorkspaceRow[];

  return (
    <main>
      <p className="eyebrow">Kommo++ · Etapa 1 · fundacao</p>
      <h1>Seus workspaces</h1>
      <p className="lede">
        Cada workspace e um tenant isolado. Voce enxerga apenas aqueles em que possui
        associacao ativa.
      </p>

      <hr className="rule" />

      {error && <p className="error">Nao foi possivel carregar os workspaces: {error.message}</p>}

      {!error && workspaces.length === 0 && (
        <div className="empty">
          <p style={{ margin: 0 }}>Nenhum workspace associado a esta conta ainda.</p>
          <p className="muted" style={{ margin: '0.5rem 0 0' }}>
            A criacao acontece pela funcao create_workspace, que vincula quem cria como owner
            na mesma transacao. A tela de criacao entra em etapa posterior.
          </p>
        </div>
      )}

      <ul className="card-list">
        {workspaces.map((ws) => (
          <li key={ws.id} className="card">
            <span className="card-slug">/{ws.slug}</span>
            <p className="card-name">
              <Link href={`/w/${ws.slug}`}>{ws.name}</Link>
            </p>
            <div className="meta">
              <span>plano {ws.plan}</span>
              <span>{ws.status}</span>
              <span>desde {new Date(ws.created_at).toLocaleDateString('pt-BR')}</span>
            </div>
          </li>
        ))}
      </ul>

      <hr className="rule" />
      <p className="muted">Sessao: {user?.email ?? 'nao autenticada'}</p>
    </main>
  );
}
