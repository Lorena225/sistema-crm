'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  enfileirar,
  listar,
  sincronizar,
  observarReconexao,
  limpar,
  type OperacaoOffline,
} from '@/lib/offline/queue';
import { createClient } from '@/lib/supabase/client';

/**
 * Tela de verificacao da fila offline (Etapa 2).
 *
 * Existe para provar o comportamento, nao para ser a tela definitiva de notas
 * — essa vem na Etapa 5. O roteiro de teste esta escrito na propria pagina
 * porque quem valida a etapa precisa reproduzir o cenario sem consultar
 * documentacao a parte.
 */
export default function OfflinePage() {
  const [operacoes, setOperacoes] = useState<OperacaoOffline[]>([]);
  const [texto, setTexto] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const [online, setOnline] = useState(true);
  const [aviso, setAviso] = useState('');

  const recarregar = useCallback(async () => {
    setOperacoes(await listar());
  }, []);

  useEffect(() => {
    setOnline(navigator.onLine);
    void recarregar();

    const supabase = createClient();
    void supabase
      .from('workspaces')
      .select('id')
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.id) setWorkspaceId(data.id);
      });

    const aoMudar = () => setOnline(navigator.onLine);
    window.addEventListener('online', aoMudar);
    window.addEventListener('offline', aoMudar);

    const parar = observarReconexao(() => {
      setAviso('Conexao voltou: fila sincronizada.');
      void recarregar();
    });

    return () => {
      window.removeEventListener('online', aoMudar);
      window.removeEventListener('offline', aoMudar);
      parar();
    };
  }, [recarregar]);

  async function registrar() {
    if (!texto.trim() || !workspaceId) return;
    await enfileirar('nota.criar', workspaceId, { texto: texto.trim() });
    setTexto('');
    setAviso('Nota guardada no aparelho. Sai da fila quando houver conexao.');
    await recarregar();
  }

  async function sincronizarAgora() {
    const r = await sincronizar();
    setAviso(`Sincronizacao: ${r.enviadas} aceita(s), ${r.recusadas} recusada(s), ${r.falhas} falha(s).`);
    await recarregar();
  }

  return (
    <main>
      <p className="eyebrow">Kommo++ · Etapa 2 · fila offline</p>
      <h1>Trabalho sem conexao</h1>
      <p className="lede">
        Registre uma nota com o aparelho offline. Ela fica guardada localmente e sobe assim que a
        conexao volta — com a autorizacao revalidada no servidor.
      </p>

      <div className="meta" style={{ marginBottom: '1.5rem' }}>
        <span>{online ? 'conectado' : 'sem conexao'}</span>
        <span>{operacoes.filter((o) => o.status !== 'concluida').length} na fila</span>
      </div>

      <label className="field">
        <span>Nota</span>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Cliente pediu retorno na quinta"
        />
      </label>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={registrar} disabled={!texto.trim() || !workspaceId}>
          Guardar nota
        </button>
        <button onClick={sincronizarAgora} disabled={!online}>
          Sincronizar agora
        </button>
        <button
          onClick={async () => {
            await limpar();
            await recarregar();
          }}
        >
          Limpar fila
        </button>
      </div>

      {!workspaceId && (
        <p className="error">
          Nenhum workspace disponivel para esta conta. Crie um workspace antes de testar a fila.
        </p>
      )}
      {aviso && <p className="notice">{aviso}</p>}

      <hr className="rule" />

      <h2>Fila local</h2>
      {operacoes.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Nada na fila.</p>
        </div>
      ) : (
        <ul className="card-list">
          {operacoes.map((op) => (
            <li key={op.id} className="card">
              <span className="card-slug">{op.tipo}</span>
              <p className="card-name">{String(op.payload.texto ?? '—')}</p>
              <div className="meta">
                <span>{op.status}</span>
                <span>{op.tentativas} tentativa(s)</span>
                <span>{new Date(op.criadaEm).toLocaleTimeString('pt-BR')}</span>
                {op.ultimoErro && <span>{op.ultimoErro}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <hr className="rule" />

      <h2>Como reproduzir</h2>
      <p className="muted">
        Abra as ferramentas do desenvolvedor, aba Network, e marque Offline. Guarde uma nota: ela
        aparece como pendente. Desmarque Offline: a fila sobe sozinha e o status vira concluida.
        Nesta etapa a operacao e autorizada mas ainda nao persistida — a tabela de notas chega na
        Etapa 5.
      </p>
    </main>
  );
}
