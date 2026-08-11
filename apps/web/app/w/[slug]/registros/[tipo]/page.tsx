'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  montarCustomFields,
  paraTexto,
  ROTULO_ENTIDADE,
  TABELA_POR_ENTIDADE,
  TITULO_POR_ENTIDADE,
  validarPrevia,
  formatarBRL,
  type EntityKind,
  type FieldDefinition,
} from '@/lib/crm/tipos';

/**
 * Uma única tela para contatos, empresas, negócios e registros de objetos.
 *
 * As quatro entidades compartilham a mesma estrutura — título, responsável,
 * custom_fields — então quatro telas quase idênticas divergiriam com o tempo.
 * O que muda entre elas são os campos fixos, declarados em CAMPOS_FIXOS.
 */

type Registro = Record<string, any>;

const CAMPOS_FIXOS: Record<EntityKind, { chave: string; rotulo: string; tipo?: string }[]> = {
  contact: [
    { chave: 'name', rotulo: 'Nome' },
    { chave: 'email', rotulo: 'E-mail', tipo: 'email' },
    { chave: 'phone', rotulo: 'Telefone' },
    { chave: 'source', rotulo: 'Origem' },
  ],
  company: [
    { chave: 'name', rotulo: 'Nome' },
    { chave: 'domain', rotulo: 'Site' },
  ],
  deal: [
    { chave: 'title', rotulo: 'Título' },
    { chave: 'value', rotulo: 'Valor (BRL)', tipo: 'number' },
  ],
  object_type: [{ chave: 'title', rotulo: 'Título' }],
};

export default function RegistrosPage({ params }: { params: { slug: string; tipo: string } }) {
  const supabase = createClient();
  const kind = params.tipo as EntityKind;

  if (!(kind in TABELA_POR_ENTIDADE)) notFound();

  const tabela = TABELA_POR_ENTIDADE[kind];
  const colunaTitulo = TITULO_POR_ENTIDADE[kind];

  const [workspaceId, setWorkspaceId] = useState('');
  const [definicoes, setDefinicoes] = useState<FieldDefinition[]>([]);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [tiposObjeto, setTiposObjeto] = useState<{ id: string; name: string }[]>([]);
  const [tipoObjetoAtivo, setTipoObjetoAtivo] = useState('');
  const [empresas, setEmpresas] = useState<{ id: string; name: string }[]>([]);
  const [vinculos, setVinculos] = useState<Record<string, string[]>>({});

  const [fixos, setFixos] = useState<Record<string, any>>({});
  const [customizados, setCustomizados] = useState<Record<string, any>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const definicoesDoEscopo = useMemo(
    () => definicoes.filter((d) =>
      kind === 'object_type' ? d.object_type_id === tipoObjetoAtivo : d.object_type_id === null),
    [definicoes, kind, tipoObjetoAtivo]
  );

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase
      .from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: defs }, { data: tipos }] = await Promise.all([
      supabase.from('field_definitions').select('*').eq('entity_kind', kind).order('position'),
      supabase.from('object_types').select('id, name').order('name'),
    ]);
    setDefinicoes((defs ?? []) as FieldDefinition[]);
    setTiposObjeto(tipos ?? []);

    let consulta = supabase.from(tabela).select('*').order('created_at', { ascending: false });
    if (kind === 'object_type' && tipoObjetoAtivo) {
      consulta = consulta.eq('object_type_id', tipoObjetoAtivo);
    }
    const { data: linhas } = await consulta;
    setRegistros(linhas ?? []);

    // Vínculos N:N só interessam nas telas de contato e empresa.
    if (kind === 'contact' || kind === 'company') {
      const [{ data: emp }, { data: links }] = await Promise.all([
        supabase.from('companies').select('id, name').order('name'),
        supabase.from('contact_company_links').select('contact_id, company_id, role'),
      ]);
      setEmpresas(emp ?? []);
      const mapa: Record<string, string[]> = {};
      for (const l of links ?? []) {
        const chave = kind === 'contact' ? l.contact_id : l.company_id;
        const nome = kind === 'contact'
          ? (emp ?? []).find((e) => e.id === l.company_id)?.name
          : l.contact_id;
        if (!mapa[chave]) mapa[chave] = [];
        if (nome) mapa[chave].push(l.role ? `${nome} (${l.role})` : String(nome));
      }
      setVinculos(mapa);
    }
  }, [kind, params.slug, supabase, tabela, tipoObjetoAtivo]);

  useEffect(() => { void carregar(); }, [carregar]);

  useEffect(() => {
    if (kind === 'object_type' && !tipoObjetoAtivo && tiposObjeto.length > 0) {
      setTipoObjetoAtivo(tiposObjeto[0].id);
    }
  }, [kind, tipoObjetoAtivo, tiposObjeto]);

  function limpar() {
    setEditando(null);
    setFixos({});
    setCustomizados({});
  }

  async function salvar() {
    setErro(''); setAviso('');

    const mensagem = validarPrevia(definicoesDoEscopo, customizados);
    if (mensagem) { setErro(mensagem); return; }

    const registro: Registro = {
      workspace_id: workspaceId,
      custom_fields: montarCustomFields(definicoesDoEscopo, customizados),
    };

    for (const campo of CAMPOS_FIXOS[kind]) {
      const valor = fixos[campo.chave];
      if (valor === '' || valor === undefined) continue;
      registro[campo.chave] = campo.tipo === 'number' ? Number(valor) : valor;
    }

    if (kind === 'object_type') registro.object_type_id = tipoObjetoAtivo;

    const { error } = editando
      ? await supabase.from(tabela).update(registro).eq('id', editando)
      : await supabase.from(tabela).insert(registro);

    if (error) { setErro(error.message); return; }

    setAviso(editando ? 'Registro atualizado.' : 'Registro criado.');
    limpar();
    await carregar();
  }

  function editar(reg: Registro) {
    setEditando(reg.id);
    const novosFixos: Record<string, any> = {};
    for (const campo of CAMPOS_FIXOS[kind]) novosFixos[campo.chave] = reg[campo.chave] ?? '';
    setFixos(novosFixos);
    setCustomizados(reg.custom_fields ?? {});
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remover(id: string) {
    const { error } = await supabase.from(tabela).delete().eq('id', id);
    if (error) { setErro(error.message); return; }
    await carregar();
  }

  async function vincularEmpresa(contatoId: string, empresaId: string, papel: string) {
    const { error } = await supabase.from('contact_company_links')
      .insert({ contact_id: contatoId, company_id: empresaId, role: papel || null });
    if (error) { setErro(error.message); return; }
    setAviso('Vínculo criado. A pessoa continua com um único cadastro.');
    await carregar();
  }

  return (
    <main>
      <h1>{ROTULO_ENTIDADE[kind]}s</h1>

      {kind === 'object_type' && (
        tiposObjeto.length === 0 ? (
          <div className="empty">
            <p style={{ margin: 0 }}>Nenhum tipo de objeto criado ainda.</p>
            <p className="muted" style={{ margin: '0.5rem 0 0' }}>
              Um tipo de objeto é um cadastro que só o seu negócio tem — Imóvel, Turma, Apólice.
              Crie um abaixo e depois configure os campos dele.
            </p>
            <CriarTipoObjeto workspaceId={workspaceId} aoCriar={carregar} />
          </div>
        ) : (
          <div className="form-linha" style={{ alignItems: 'flex-end' }}>
            <label className="field">
              <span>Tipo de objeto</span>
              <select value={tipoObjetoAtivo} onChange={(e) => setTipoObjetoAtivo(e.target.value)}>
                {tiposObjeto.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <CriarTipoObjeto workspaceId={workspaceId} aoCriar={carregar} />
          </div>
        )
      )}

      {(kind !== 'object_type' || tiposObjeto.length > 0) && (
        <div className="painel">
          <h2>{editando ? 'Editar registro' : 'Novo registro'}</h2>

          <div className="form-linha">
            {CAMPOS_FIXOS[kind].map((campo) => (
              <label key={campo.chave} className="field">
                <span>{campo.rotulo}</span>
                <input
                  type={campo.tipo ?? 'text'}
                  value={fixos[campo.chave] ?? ''}
                  onChange={(e) => setFixos({ ...fixos, [campo.chave]: e.target.value })}
                />
              </label>
            ))}
          </div>

          {definicoesDoEscopo.length > 0 && (
            <>
              <p className="eyebrow" style={{ marginTop: '1rem' }}>Campos do seu negócio</p>
              <div className="form-linha">
                {definicoesDoEscopo.map((def) => (
                  <EntradaCampo
                    key={def.id}
                    definicao={def}
                    valor={customizados[def.key]}
                    aoMudar={(v) => setCustomizados({ ...customizados, [def.key]: v })}
                  />
                ))}
              </div>
            </>
          )}

          <div className="acoes">
            <button onClick={salvar} disabled={!workspaceId}>
              {editando ? 'Salvar alterações' : 'Criar'}
            </button>
            {editando && <button className="secundario" onClick={limpar}>Cancelar</button>}
          </div>

          {erro && <p className="error">{erro}</p>}
          {aviso && <p className="notice">{aviso}</p>}
        </div>
      )}

      {registros.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nenhum registro ainda.</p></div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                {CAMPOS_FIXOS[kind].map((c) => <th key={c.chave}>{c.rotulo}</th>)}
                {definicoesDoEscopo.map((d) => <th key={d.id}>{d.label}</th>)}
                {(kind === 'contact' || kind === 'company') && <th>Vínculos</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {registros.map((reg) => (
                <tr key={reg.id}>
                  {CAMPOS_FIXOS[kind].map((c) => (
                    <td key={c.chave}>
                      {c.chave === 'value'
                        ? formatarBRL(reg.value, reg.currency ?? 'BRL')
                        : (reg[c.chave] ?? '—')}
                    </td>
                  ))}
                  {definicoesDoEscopo.map((d) => (
                    <td key={d.id}>{paraTexto(d.field_type, reg.custom_fields?.[d.key])}</td>
                  ))}
                  {(kind === 'contact' || kind === 'company') && (
                    <td className="etiquetas">
                      {(vinculos[reg.id] ?? []).map((v) => (
                        <span key={v} className="etiqueta">{v}</span>
                      ))}
                      {kind === 'contact' && (
                        <VincularEmpresa
                          empresas={empresas}
                          aoVincular={(empresaId, papel) => vincularEmpresa(reg.id, empresaId, papel)}
                        />
                      )}
                    </td>
                  )}
                  <td className="acoes-linha">
                    <button className="link" onClick={() => editar(reg)}>editar</button>
                    <button className="link perigo" onClick={() => remover(reg.id)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        {registros.length} registro(s). O nome principal de cada linha vem da coluna{' '}
        <span className="mono">{colunaTitulo}</span>.
      </p>
    </main>
  );
}

/** Entrada de formulário adequada a cada field_type. */
function EntradaCampo({
  definicao, valor, aoMudar,
}: {
  definicao: FieldDefinition;
  valor: any;
  aoMudar: (v: any) => void;
}) {
  const { field_type: tipo, label, options } = definicao;

  if (tipo === 'boolean') {
    return (
      <label className="field marcador-campo">
        <span>{label}</span>
        <input type="checkbox" checked={!!valor} onChange={(e) => aoMudar(e.target.checked)} />
      </label>
    );
  }

  if (tipo === 'select') {
    return (
      <label className="field">
        <span>{label}{definicao.is_required && ' *'}</span>
        <select value={valor ?? ''} onChange={(e) => aoMudar(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  if (tipo === 'multiselect') {
    return (
      <label className="field">
        <span>{label}{definicao.is_required && ' *'}</span>
        <select
          multiple
          value={Array.isArray(valor) ? valor : []}
          onChange={(e) => aoMudar(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
    );
  }

  const tipoHtml =
    tipo === 'number' || tipo === 'currency' ? 'number'
    : tipo === 'date' ? 'date'
    : tipo === 'email' ? 'email'
    : tipo === 'phone' ? 'tel'
    : 'text';

  return (
    <label className="field">
      <span>
        {label}{definicao.is_required && ' *'}
        {tipo === 'ai_generated' && <span className="muted"> · gerado por IA</span>}
      </span>
      <input
        type={tipoHtml}
        step={tipo === 'currency' ? '0.01' : undefined}
        value={valor ?? ''}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={tipo === 'relation' ? 'identificador do registro' : undefined}
      />
    </label>
  );
}

function CriarTipoObjeto({ workspaceId, aoCriar }: { workspaceId: string; aoCriar: () => void }) {
  const supabase = createClient();
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');

  async function criar() {
    setErro('');
    const { error } = await supabase.from('object_types')
      .insert({ workspace_id: workspaceId, name: nome.trim() });
    if (error) { setErro(error.message); return; }
    setNome('');
    aoCriar();
  }

  return (
    <div className="inline-form">
      <input
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        placeholder="Imóvel, Turma, Apólice…"
      />
      <button onClick={criar} disabled={!nome.trim() || !workspaceId}>Criar tipo</button>
      {erro && <span className="error">{erro}</span>}
    </div>
  );
}

function VincularEmpresa({
  empresas, aoVincular,
}: {
  empresas: { id: string; name: string }[];
  aoVincular: (empresaId: string, papel: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [papel, setPapel] = useState('');

  if (empresas.length === 0) return null;

  if (!aberto) {
    return <button className="link" onClick={() => setAberto(true)}>+ empresa</button>;
  }

  return (
    <div className="inline-form">
      <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
        <option value="">Empresa…</option>
        {empresas.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>
      <input value={papel} onChange={(e) => setPapel(e.target.value)} placeholder="Papel" />
      <button
        onClick={() => { aoVincular(empresa, papel); setAberto(false); setEmpresa(''); setPapel(''); }}
        disabled={!empresa}
      >
        Vincular
      </button>
    </div>
  );
}
