'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatarBRL } from '@/lib/crm/tipos';

/**
 * Catálogo comercial: produtos, tabelas de preço e as entradas que ligam os
 * dois. A entrada específica vence o preço padrão do produto — regra aplicada
 * pelo banco, não por esta tela.
 */
export default function ProdutosPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [produtos, setProdutos] = useState<any[]>([]);
  const [tabelas, setTabelas] = useState<any[]>([]);
  const [entradas, setEntradas] = useState<any[]>([]);
  const [tabelaAtiva, setTabelaAtiva] = useState('');
  const [erro, setErro] = useState('');

  const [novoProduto, setNovoProduto] = useState({ name: '', sku: '', default_price: '' });
  const [novaTabela, setNovaTabela] = useState({ name: '', is_default: false });
  const [novaEntrada, setNovaEntrada] = useState({ product_id: '', unit_price: '' });

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase.from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    const [{ data: p }, { data: b }, { data: e }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('price_books').select('*').order('name'),
      supabase.from('price_book_entries').select('*'),
    ]);

    setProdutos(p ?? []);
    setTabelas(b ?? []);
    setEntradas(e ?? []);
    if (!tabelaAtiva && b?.length) setTabelaAtiva((b.find((x) => x.is_default) ?? b[0]).id);
  }, [params.slug, supabase, tabelaAtiva]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function criarProduto() {
    setErro('');
    const { error } = await supabase.from('products').insert({
      workspace_id: workspaceId,
      name: novoProduto.name,
      sku: novoProduto.sku || null,
      default_price: novoProduto.default_price === '' ? null : Number(novoProduto.default_price),
    });
    if (error) { setErro(error.message); return; }
    setNovoProduto({ name: '', sku: '', default_price: '' });
    await carregar();
  }

  async function criarTabela() {
    setErro('');
    const { error } = await supabase.from('price_books')
      .insert({ workspace_id: workspaceId, name: novaTabela.name, is_default: novaTabela.is_default });
    if (error) { setErro(error.message); return; }
    setNovaTabela({ name: '', is_default: false });
    await carregar();
  }

  async function criarEntrada() {
    setErro('');
    const { error } = await supabase.from('price_book_entries').insert({
      price_book_id: tabelaAtiva,
      product_id: novaEntrada.product_id,
      unit_price: Number(novaEntrada.unit_price),
    });
    if (error) { setErro(error.message); return; }
    setNovaEntrada({ product_id: '', unit_price: '' });
    await carregar();
  }

  const entradasDaTabela = entradas.filter((e) => e.price_book_id === tabelaAtiva);

  return (
    <main>
      <h1>Catálogo comercial</h1>
      <p className="lede">
        Todos os valores em reais. Ao montar um negócio, o preço vem da tabela escolhida; sem
        entrada para aquele produto, vale o preço padrão dele.
      </p>

      <div className="painel">
        <h2>Novo produto</h2>
        <div className="form-linha">
          <label className="field">
            <span>Nome</span>
            <input value={novoProduto.name} onChange={(e) => setNovoProduto({ ...novoProduto, name: e.target.value })} />
          </label>
          <label className="field">
            <span>SKU</span>
            <input value={novoProduto.sku} onChange={(e) => setNovoProduto({ ...novoProduto, sku: e.target.value })} />
          </label>
          <label className="field">
            <span>Preço padrão (BRL)</span>
            <input type="number" step="0.01" value={novoProduto.default_price}
              onChange={(e) => setNovoProduto({ ...novoProduto, default_price: e.target.value })} />
          </label>
        </div>
        <div className="acoes">
          <button onClick={criarProduto} disabled={!novoProduto.name || !workspaceId}>Criar produto</button>
        </div>
        {erro && <p className="error">{erro}</p>}
      </div>

      {produtos.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead><tr><th>Produto</th><th>SKU</th><th>Preço padrão</th><th>Situação</th></tr></thead>
            <tbody>
              {produtos.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="mono">{p.sku ?? '—'}</td>
                  <td>{formatarBRL(p.default_price, p.currency)}</td>
                  <td>{p.is_active ? 'ativo' : 'inativo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Tabelas de preço</h2>
      <div className="inline-form">
        <input value={novaTabela.name} onChange={(e) => setNovaTabela({ ...novaTabela, name: e.target.value })}
          placeholder="Tabela 2026" />
        <label className="marcador">
          <input type="checkbox" checked={novaTabela.is_default}
            onChange={(e) => setNovaTabela({ ...novaTabela, is_default: e.target.checked })} />
          padrão
        </label>
        <button onClick={criarTabela} disabled={!novaTabela.name || !workspaceId}>Criar tabela</button>
      </div>

      {tabelas.length > 0 && (
        <>
          <div className="form-linha" style={{ marginTop: '1rem' }}>
            <label className="field">
              <span>Tabela</span>
              <select value={tabelaAtiva} onChange={(e) => setTabelaAtiva(e.target.value)}>
                {tabelas.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.is_default ? ' (padrão)' : ''}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="inline-form">
            <select value={novaEntrada.product_id}
              onChange={(e) => setNovaEntrada({ ...novaEntrada, product_id: e.target.value })}>
              <option value="">Produto…</option>
              {produtos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" step="0.01" value={novaEntrada.unit_price}
              onChange={(e) => setNovaEntrada({ ...novaEntrada, unit_price: e.target.value })}
              placeholder="Preço nesta tabela" />
            <button onClick={criarEntrada} disabled={!novaEntrada.product_id || !novaEntrada.unit_price}>
              Definir preço
            </button>
          </div>

          {entradasDaTabela.length === 0 ? (
            <p className="muted">Sem preços nesta tabela. Os negócios usarão o preço padrão de cada produto.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead><tr><th>Produto</th><th>Preço na tabela</th><th>Preço padrão</th></tr></thead>
                <tbody>
                  {entradasDaTabela.map((e) => {
                    const p = produtos.find((x) => x.id === e.product_id);
                    return (
                      <tr key={e.id}>
                        <td>{p?.name ?? '—'}</td>
                        <td className="mono">{formatarBRL(e.unit_price)}</td>
                        <td className="muted">{formatarBRL(p?.default_price)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
