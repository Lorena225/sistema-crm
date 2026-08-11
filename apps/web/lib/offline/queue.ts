'use client';

/**
 * Fila offline local.
 *
 * O caso real: o operador de campo perde sinal, registra o que aconteceu na
 * visita e so reencontra rede depois. Se a acao depender de conexao no
 * instante do toque, ela se perde — e o dado que se perde e justamente o que
 * ninguem vai voltar para digitar.
 *
 * IndexedDB, e nao localStorage: sobrevive a fechar o navegador, guarda
 * objeto estruturado sem serializar na mao e nao trava a thread principal.
 *
 * Operacoes sao TIPADAS e ADIADAS: a fila guarda a intencao ('nota.criar' com
 * seu payload), nao uma chamada HTTP montada. Isso permite que a Etapa 4
 * (tarefas) e a Etapa 5 (notas) mudem o destino sem invalidar o que ja esta
 * na fila do aparelho de alguem.
 */

const BANCO = 'kommopp-offline';
const VERSAO = 1;
const LOJA = 'operacoes';

export type TipoOperacao = 'nota.criar' | 'tarefa.criar' | 'checkin.registrar';

export type StatusOperacao = 'pendente' | 'sincronizando' | 'concluida' | 'falhou';

export interface OperacaoOffline {
  id: string;
  tipo: TipoOperacao;
  workspaceId: string;
  payload: Record<string, unknown>;
  status: StatusOperacao;
  tentativas: number;
  criadaEm: string;
  ultimoErro?: string;
}

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BANCO, VERSAO);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOJA)) {
        const loja = db.createObjectStore(LOJA, { keyPath: 'id' });
        loja.createIndex('status', 'status');
        loja.createIndex('workspaceId', 'workspaceId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function transacionar<T>(modo: IDBTransactionMode, fn: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return abrir().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(LOJA, modo);
        const req = fn(tx.objectStore(LOJA));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      })
  );
}

export async function enfileirar(
  tipo: TipoOperacao,
  workspaceId: string,
  payload: Record<string, unknown>
): Promise<OperacaoOffline> {
  const operacao: OperacaoOffline = {
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    tipo,
    workspaceId,
    payload,
    status: 'pendente',
    tentativas: 0,
    criadaEm: new Date().toISOString(),
  };

  await transacionar('readwrite', (loja) => loja.add(operacao));
  return operacao;
}

export async function listar(): Promise<OperacaoOffline[]> {
  const todas = await transacionar<OperacaoOffline[]>('readonly', (loja) => loja.getAll());
  return todas.sort((a, b) => a.criadaEm.localeCompare(b.criadaEm));
}

export async function pendentes(): Promise<OperacaoOffline[]> {
  const todas = await listar();
  return todas.filter((o) => o.status === 'pendente' || o.status === 'falhou');
}

async function salvar(operacao: OperacaoOffline): Promise<void> {
  await transacionar('readwrite', (loja) => loja.put(operacao));
}

export async function limpar(): Promise<void> {
  await transacionar('readwrite', (loja) => loja.clear());
}

/**
 * Envia as operacoes pendentes.
 *
 * O servidor revalida a autorizacao de cada operacao: uma acao registrada
 * offline as 9h por alguem que foi removido do workspace as 10h nao pode ser
 * aceita as 11h so porque estava na fila. A fila e uma intencao, nao uma
 * permissao — e por isso a sincronizacao nao relaxa a RLS.
 */
export async function sincronizar(): Promise<{ enviadas: number; recusadas: number; falhas: number }> {
  const fila = await pendentes();
  let enviadas = 0;
  let recusadas = 0;
  let falhas = 0;

  for (const operacao of fila) {
    operacao.status = 'sincronizando';
    operacao.tentativas += 1;
    await salvar(operacao);

    try {
      const resposta = await fetch('/api/offline/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: operacao.id,
          tipo: operacao.tipo,
          workspaceId: operacao.workspaceId,
          payload: operacao.payload,
          criadaEm: operacao.criadaEm,
        }),
      });

      if (resposta.ok) {
        operacao.status = 'concluida';
        delete operacao.ultimoErro;
        enviadas += 1;
      } else if (resposta.status === 403 || resposta.status === 401) {
        // Autorizacao revogada entre o registro e a sincronizacao.
        operacao.status = 'falhou';
        operacao.ultimoErro = 'sem_autorizacao_no_workspace';
        recusadas += 1;
      } else {
        operacao.status = 'falhou';
        operacao.ultimoErro = `http_${resposta.status}`;
        falhas += 1;
      }
    } catch (erro) {
      // Ainda sem rede: continua pendente, sem perder nada.
      operacao.status = 'pendente';
      operacao.ultimoErro = erro instanceof Error ? erro.message : 'falha_de_rede';
      falhas += 1;
    }

    await salvar(operacao);
  }

  return { enviadas, recusadas, falhas };
}

/** Dispara a sincronizacao quando a conexao volta. */
export function observarReconexao(aoSincronizar?: () => void): () => void {
  const aoVoltar = () => {
    void sincronizar().then(() => aoSincronizar?.());
  };
  window.addEventListener('online', aoVoltar);
  return () => window.removeEventListener('online', aoVoltar);
}
