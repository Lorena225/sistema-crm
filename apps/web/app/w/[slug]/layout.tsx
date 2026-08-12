import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Casca do workspace. Resolve o slug e monta a navegacao.
 *
 * A consulta nao filtra por membro: a RLS ja faz isso. Se o slug existir mas
 * pertencer a outro tenant, a consulta volta vazia e a pagina responde 404 —
 * a mesma resposta de um slug inexistente, para nao revelar que o workspace
 * existe.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { slug: string };
}) {
  const supabase = createClient();
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!workspace) notFound();

  const base = `/w/${workspace.slug}`;
  const abas = [
    { href: base, rotulo: 'Visão geral' },
    { href: `${base}/inbox`, rotulo: 'Inbox' },
    { href: `${base}/registros/contact`, rotulo: 'Contatos' },
    { href: `${base}/registros/company`, rotulo: 'Empresas' },
    { href: `${base}/registros/deal`, rotulo: 'Negócios' },
    { href: `${base}/registros/object_type`, rotulo: 'Objetos' },
    { href: `${base}/pipelines`, rotulo: 'Pipelines' },
    { href: `${base}/tarefas`, rotulo: 'Tarefas' },
    { href: `${base}/agendamento`, rotulo: 'Agendamento' },
    { href: `${base}/campanhas`, rotulo: 'Campanhas' },
    { href: `${base}/produtos`, rotulo: 'Produtos' },
    { href: `${base}/canais`, rotulo: 'Canais' },
    { href: `${base}/campos`, rotulo: 'Campos' },
  ];

  return (
    <>
      <header className="ws-header">
        <p className="eyebrow">{workspace.name}</p>
        <nav className="ws-nav">
          {abas.map((aba) => (
            <Link key={aba.href} href={aba.href}>
              {aba.rotulo}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </>
  );
}
