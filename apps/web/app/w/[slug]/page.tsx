import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function VisaoGeral({ params }: { params: { slug: string } }) {
  const supabase = createClient();
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .eq('slug', params.slug)
    .maybeSingle();

  if (!workspace) return null;

  // Contagens em paralelo. head: true traz so o total, sem os registros.
  const contar = (tabela: string) =>
    supabase.from(tabela).select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id);

  const [contatos, empresas, negocios, objetos, campos, pipelines] = await Promise.all([
    contar('contacts'), contar('companies'), contar('deals'),
    contar('object_records'), contar('field_definitions'), contar('pipelines'),
  ]);

  const cartoes = [
    { rotulo: 'Contatos', total: contatos.count ?? 0, href: `/w/${params.slug}/registros/contact` },
    { rotulo: 'Empresas', total: empresas.count ?? 0, href: `/w/${params.slug}/registros/company` },
    { rotulo: 'Negócios', total: negocios.count ?? 0, href: `/w/${params.slug}/registros/deal` },
    { rotulo: 'Registros de objetos', total: objetos.count ?? 0, href: `/w/${params.slug}/registros/object_type` },
    { rotulo: 'Campos configurados', total: campos.count ?? 0, href: `/w/${params.slug}/campos` },
    { rotulo: 'Pipelines', total: pipelines.count ?? 0, href: `/w/${params.slug}/pipelines` },
  ];

  return (
    <main>
      <h1>Visão geral</h1>
      <p className="lede">
        O que existe neste workspace agora. Comece pelos campos se quiser adaptar os cadastros ao
        seu negócio antes de registrar dados.
      </p>

      <div className="grade">
        {cartoes.map((c) => (
          <Link key={c.rotulo} href={c.href} className="card metrica">
            <span className="metrica-total">{c.total}</span>
            <span className="metrica-rotulo">{c.rotulo}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
