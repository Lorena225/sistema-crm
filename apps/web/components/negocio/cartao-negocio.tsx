'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { formatarBRL } from '@/lib/crm/tipos';

/**
 * Cartão do negócio com seus itens.
 *
 * Componente isolado de propósito: o cockpit da Etapa 5 vai precisar
 * exatamente disto ao lado da conversa. Ele não conhece a página em que está
 * — recebe `dealId` e se vira.
 *
 * O total não é somado aqui. `deals.value` é recalculado pelo banco a cada
 * mudança de item, então a tela relê o negócio depois de escrever, em vez de
 * manter uma segunda contabilidade que pode divergir.
 */

interface Item {
  id: string;
  product_id: string;
  price_book_id: string | null;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  line_total: number;
}

interface Produto { id: string; name: string; default_price: number | null; is_active: boolean }
interface PriceBook { id: string; name: string; is_default: boolean }

export function CartaoNegocio({ dealId, aoMudar }: { dealId: string; aoMudar?: () => void }) {
  const supabase = createClient();

  const [negocio, setNegocio] = useState<any>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [priceBooks, setPriceBooks] = useState<PriceBook[]>([]);
  const [erro, setErro] = useState('');

  const [novo, setNovo] = useState({ product_id: '', price_book_id: '', quantity: '1', desconto: '0' });
  const [valorManual, setValorManual] = useState('');

  const carregar = useCallback(async () => {
    const [{ data: d }, { data: li }, { data: prods }, { data: pbs }] = await Promise.all([
      supabase.from('deals').select('id, title, value, currency, status').eq('id', dealId).maybeSingle(),
      supabase.from('deal_line_items').select('*').eq('deal_id', dealId).order('id'),
      supabase.from('products').select('id, name, default_price, is_active').eq('is_active', true).order('name'),
      supabase.from('price_books').select('id, name, is_default').order('name'),
    ]);

    setNegocio(d);
    setItens((li ?? []) as Item[]);
    setProdutos(prods ?? []);
    setPriceBooks(pbs ?? []);
    setValorManual(d?.value != null ? String(d.value) : '');

    if (!novo.price_book_id && pbs?.length) {
      setNovo((n) => ({ ...n, price_book_id: (pbs.find((p) => p.is_default) ?? pbs[0]).id }));
    }
  }, [dealId, supabase, novo.price_book_id]);

  useEffect(() => { void carregar(); }, [dealId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function adicionar() {
    setErro('');
    if (!novo.product_id) return;

    // A interface fala em porcentagem; o banco guarda a fração que a fórmula
    // do escopo usa. A conversão acontece aqui, num lugar só.
    const { error } = await supabase.from('deal_line_items').insert({
      deal_id: dealId,
      product_id: novo.product_id,
      price_book_id: novo.price_book_id || null,
      quantity: Number(novo.quantity) || 1,
      discount_percent: (Number(novo.desconto) || 0) / 100,
    });

    if (error) { setErro(error.message); return; }
    setNovo({ ...novo, product_id: '', quantity: '1', desconto: '0' });
    await carregar();
    aoMudar?.();
  }

  async function alterar(item: Item, campo: 'quantity' | 'discount_percent', valor: number) {
    const { error } = await supabase.from('deal_line_items').update({ [campo]: valor }).eq('id', item.id);
    if (error) { setErro(error.message); return; }
    await carregar();
    aoMudar?.();
  }

  async function remover(id: string) {
    const { error } = await supabase.from('deal_line_items').delete().eq('id', id);
    if (error) { setErro(error.message); return; }
    await carregar();
    aoMudar?.();
  }

  async function salvarValorManual() {
    const { error } = await supabase.from('deals')
      .update({ value: valorManual === '' ? null : Number(valorManual) }).eq('id', dealId);
    if (error) { setErro(error.message); return; }
    await carregar();
    aoMudar?.();
  }

  if (!negocio) return <div className="painel"><p className="muted">Carregando negócio…</p></div>;

  const temItens = itens.length > 0;

  return (
    <div className="painel cartao-negocio">
      <div className="coluna-topo">
        <h2 style={{ margin: 0 }}>{negocio.title}</h2>
        <span className="valor-negocio">{formatarBRL(negocio.value, negocio.currency ?? 'BRL')}</span>
      </div>

      {temItens ? (
        <div className="tabela-rolagem">
          <table className="tabela">
            <thead>
              <tr>
                <th>Produto</th><th>Qtd.</th><th>Preço unit.</th><th>Desc.</th><th>Total</th><th />
              </tr>
            </thead>
            <tbody>
              {itens.map((item) => (
                <tr key={item.id}>
                  <td>{produtos.find((p) => p.id === item.product_id)?.name ?? '—'}</td>
                  <td>
                    <input
                      className="celula"
                      type="number"
                      min="0.01"
                      step="1"
                      defaultValue={item.quantity}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (v > 0 && v !== Number(item.quantity)) void alterar(item, 'quantity', v);
                      }}
                    />
                  </td>
                  <td>{formatarBRL(item.unit_price)}</td>
                  <td>
                    <input
                      className="celula"
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      defaultValue={Math.round(item.discount_percent * 100)}
                      onBlur={(e) => {
                        const v = (Number(e.target.value) || 0) / 100;
                        if (v !== Number(item.discount_percent)) void alterar(item, 'discount_percent', v);
                      }}
                    />
                    <span className="muted"> %</span>
                  </td>
                  <td className="mono">{formatarBRL(item.line_total)}</td>
                  <td className="acoes-linha">
                    <button className="link perigo" onClick={() => remover(item.id)}>remover</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <p style={{ margin: 0 }}>Sem itens. O valor do negócio é digitado à mão.</p>
        </div>
      )}

      <div className="inline-form" style={{ marginTop: '0.75rem' }}>
        <select value={novo.product_id} onChange={(e) => setNovo({ ...novo, product_id: e.target.value })}>
          <option value="">Produto…</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}{p.default_price != null ? ` · ${formatarBRL(p.default_price)}` : ''}
            </option>
          ))}
        </select>
        <select value={novo.price_book_id} onChange={(e) => setNovo({ ...novo, price_book_id: e.target.value })}>
          <option value="">Sem tabela</option>
          {priceBooks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <input
          type="number" min="0.01" step="1" value={novo.quantity}
          onChange={(e) => setNovo({ ...novo, quantity: e.target.value })}
          placeholder="Qtd." style={{ width: '5rem' }}
        />
        <input
          type="number" min="0" max="100" value={novo.desconto}
          onChange={(e) => setNovo({ ...novo, desconto: e.target.value })}
          placeholder="% desc." style={{ width: '6rem' }}
        />
        <button onClick={adicionar} disabled={!novo.product_id}>Adicionar item</button>
      </div>

      {!temItens && (
        <div className="inline-form" style={{ marginTop: '0.75rem' }}>
          <input
            type="number" step="0.01" value={valorManual}
            onChange={(e) => setValorManual(e.target.value)}
            placeholder="Valor do negócio (BRL)"
          />
          <button className="secundario" onClick={salvarValorManual}>Salvar valor</button>
        </div>
      )}

      <p className="muted" style={{ marginTop: '0.75rem' }}>
        {temItens
          ? 'Com itens, o valor do negócio é a soma das linhas e o banco o mantém atualizado.'
          : 'Assim que houver um item, o valor passa a ser calculado e este campo some.'}
      </p>

      {erro && <p className="error">{erro}</p>}
    </div>
  );
}
