'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  exigeOpcoes,
  ROTULO_ENTIDADE,
  ROTULO_SENSIBILIDADE,
  ROTULO_TIPO,
  type EntityKind,
  type FieldDefinition,
  type FieldType,
  type Sensitivity,
} from '@/lib/crm/tipos';

const TIPOS = Object.keys(ROTULO_TIPO) as FieldType[];
const PAPEIS = ['owner', 'admin', 'manager', 'agent', 'viewer'];

interface ObjectType {
  id: string;
  name: string;
}

export default function CamposPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [tiposObjeto, setTiposObjeto] = useState<ObjectType[]>([]);
  const [campos, setCampos] = useState<FieldDefinition[]>([]);
  const [versoes, setVersoes] = useState<Record<string, number>>({});
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState<string | null>(null);

  const [form, setForm] = useState({
    entity_kind: 'contact' as EntityKind,
    object_type_id: '',
    key: '',
    label: '',
    field_type: 'text' as FieldType,
    opcoes: '',
    is_required: false,
    is_filterable: false,
    position: 0,
    editable_roles: [] as string[],
    sensitivity_level: 'none' as Sensitivity,
  });

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase
      .from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: tipos }, { data: defs }] = await Promise.all([
      supabase.from('object_types').select('id, name').order('name'),
      supabase.from('field_definitions').select('*').order('entity_kind').order('position'),
    ]);

    setTiposObjeto(tipos ?? []);
    setCampos((defs ?? []) as FieldDefinition[]);

    // Quantas versoes cada campo ja teve — a prova visivel de que o
    // versionamento esta funcionando.
    const { data: hist } = await supabase
      .from('field_schema_versions').select('field_definition_id, version');
    const contagem: Record<string, number> = {};
    for (const h of hist ?? []) {
      contagem[h.field_definition_id] = Math.max(contagem[h.field_definition_id] ?? 0, h.version);
    }
    setVersoes(contagem);
  }, [params.slug, supabase]);

  useEffect(() => { void carregar(); }, [carregar]);

  function limpar() {
    setEditando(null);
    setForm({
      entity_kind: 'contact', object_type_id: '', key: '', label: '',
      field_type: 'text', opcoes: '', is_required: false, is_filterable: false,
      position: 0, editable_roles: [], sensitivity_level: 'none',
    });
  }

  async function salvar() {
    setErro(''); setAviso('');

    if (!/^[a-z][a-z0-9_]*[a-z0-9]$/.test(form.key)) {
      setErro('A chave usa letras minúsculas, números e sublinhado, e não pode terminar em sublinhado.');
      return;
    }
    if (form.entity_kind === 'object_type' && !form.object_type_id) {
      setErro('Escolha a qual tipo de objeto o campo pertence.');
      return;
    }

    const opcoes = form.opcoes.split('\n').map((o) => o.trim()).filter(Boolean);
    if (exigeOpcoes(form.field_type) && opcoes.length === 0) {
      setErro('Escolha única e múltipla precisam de pelo menos uma opção.');
      return;
    }

    const registro = {
      workspace_id: workspaceId,
      entity_kind: form.entity_kind,
      object_type_id: form.entity_kind === 'object_type' ? form.object_type_id : null,
      key: form.key,
      label: form.label,
      field_type: form.field_type,
      options: opcoes,
      is_required: form.is_required,
      is_filterable: form.is_filterable,
      position: Number(form.position) || 0,
      editable_roles: form.editable_roles,
      sensitivity_level: form.sensitivity_level,
    };

    const { error } = editando
      ? await supabase.from('field_definitions').update(registro).eq('id', editando)
      : await supabase.from('field_definitions').insert(registro);

    if (error) { setErro(error.message); return; }

    setAviso(editando ? 'Campo atualizado. Uma nova versão foi registrada.' : 'Campo criado.');
    limpar();
    await carregar();
  }

  async function editar(campo: FieldDefinition) {
    setEditando(campo.id);
    setForm({
      entity_kind: campo.entity_kind,
      object_type_id: campo.object_type_id ?? '',
      key: campo.key,
      label: campo.label,
      field_type: campo.field_type,
      opcoes: (campo.options ?? []).join('\n'),
      is_required: campo.is_required,
      is_filterable: campo.is_filterable,
      position: campo.position,
      editable_roles: campo.editable_roles ?? [],
      sensitivity_level: campo.sensitivity_level,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remover(campo: FieldDefinition) {
    setErro(''); setAviso('');
    const { error } = await supabase.from('field_definitions').delete().eq('id', campo.id);
    if (error) { setErro(error.message); return; }
    setAviso(`Campo ${campo.label} removido. O histórico de versões permanece.`);
    await carregar();
  }

  return (
    <main>
      <h1>Campos</h1>
      <p className="lede">
        Adapte os cadastros ao seu negócio sem depender de código. Cada alteração é versionada, e
        os valores gravados são validados no banco antes de entrar.
      </p>

      <div className="painel">
        <h2>{editando ? 'Editar campo' : 'Novo campo'}</h2>

        <div className="form-linha">
          <label className="field">
            <span>Onde aparece</span>
            <select
              value={form.entity_kind}
              onChange={(e) => setForm({ ...form, entity_kind: e.target.value as EntityKind })}
            >
              {(Object.keys(ROTULO_ENTIDADE) as EntityKind[]).map((k) => (
                <option key={k} value={k}>{ROTULO_ENTIDADE[k]}</option>
              ))}
            </select>
          </label>

          {form.entity_kind === 'object_type' && (
            <label className="field">
              <span>Tipo de objeto</span>
              <select
                value={form.object_type_id}
                onChange={(e) => setForm({ ...form, object_type_id: e.target.value })}
              >
                <option value="">Escolha…</option>
                {tiposObjeto.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}

          <label className="field">
            <span>Tipo do campo</span>
            <select
              value={form.field_type}
              onChange={(e) => setForm({ ...form, field_type: e.target.value as FieldType })}
            >
              {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            </select>
          </label>
        </div>

        <div className="form-linha">
          <label className="field">
            <span>Rótulo</span>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="CPF do titular"
            />
          </label>

          <label className="field">
            <span>Chave técnica</span>
            <input
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="cpf_titular"
              disabled={!!editando}
            />
          </label>

          <label className="field campo-curto">
            <span>Ordem</span>
            <input
              type="number"
              value={form.position}
              onChange={(e) => setForm({ ...form, position: Number(e.target.value) })}
            />
          </label>
        </div>

        {exigeOpcoes(form.field_type) && (
          <label className="field largo">
            <span>Opções — uma por linha</span>
            <textarea
              rows={4}
              value={form.opcoes}
              onChange={(e) => setForm({ ...form, opcoes: e.target.value })}
              placeholder={'Indicação\nAnúncio\nEvento'}
            />
          </label>
        )}

        {form.field_type === 'ai_generated' && (
          <p className="muted">
            O campo fica disponível e guarda valores normalmente. A geração automática depende da
            runtime de IA, que chega em etapa posterior.
          </p>
        )}

        <div className="form-linha">
          <label className="field">
            <span>Sensibilidade</span>
            <select
              value={form.sensitivity_level}
              onChange={(e) => setForm({ ...form, sensitivity_level: e.target.value as Sensitivity })}
            >
              {(Object.keys(ROTULO_SENSIBILIDADE) as Sensitivity[]).map((s) => (
                <option key={s} value={s}>{ROTULO_SENSIBILIDADE[s]}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Quem pode editar</span>
            <select
              multiple
              value={form.editable_roles}
              onChange={(e) => setForm({
                ...form,
                editable_roles: Array.from(e.target.selectedOptions, (o) => o.value),
              })}
            >
              {PAPEIS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>

          <div className="field marcadores">
            <label className="marcador">
              <input
                type="checkbox"
                checked={form.is_required}
                onChange={(e) => setForm({ ...form, is_required: e.target.checked })}
              />
              Obrigatório
            </label>
            <label className="marcador">
              <input
                type="checkbox"
                checked={form.is_filterable}
                onChange={(e) => setForm({ ...form, is_filterable: e.target.checked })}
              />
              Filtrável
            </label>
          </div>
        </div>

        <div className="acoes">
          <button onClick={salvar} disabled={!form.label || !form.key || !workspaceId}>
            {editando ? 'Salvar alterações' : 'Criar campo'}
          </button>
          {editando && <button className="secundario" onClick={limpar}>Cancelar</button>}
        </div>

        {erro && <p className="error">{erro}</p>}
        {aviso && <p className="notice">{aviso}</p>}
      </div>

      <h2>Campos configurados</h2>
      {campos.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Nenhum campo ainda. Os cadastros funcionam sem eles.</p>
        </div>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Rótulo</th><th>Chave</th><th>Tipo</th><th>Onde</th>
                <th>Regras</th><th>Versão</th><th />
              </tr>
            </thead>
            <tbody>
              {campos.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="mono">{c.key}</td>
                  <td>{ROTULO_TIPO[c.field_type]}</td>
                  <td>
                    {ROTULO_ENTIDADE[c.entity_kind]}
                    {c.object_type_id && (
                      <span className="muted"> · {tiposObjeto.find((t) => t.id === c.object_type_id)?.name}</span>
                    )}
                  </td>
                  <td className="etiquetas">
                    {c.is_required && <span className="etiqueta">obrigatório</span>}
                    {c.is_filterable && <span className="etiqueta">filtrável</span>}
                    {c.sensitivity_level !== 'none' && (
                      <span className="etiqueta alerta">{ROTULO_SENSIBILIDADE[c.sensitivity_level]}</span>
                    )}
                  </td>
                  <td className="mono">v{versoes[c.id] ?? 1}</td>
                  <td className="acoes-linha">
                    <button className="link" onClick={() => editar(c)}>editar</button>
                    <button className="link perigo" onClick={() => remover(c)}>remover</button>
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
