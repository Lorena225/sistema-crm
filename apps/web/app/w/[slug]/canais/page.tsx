'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Onboarding de canal e diagnostico de qualidade.
 *
 * Fecha o criterio de aceite 4 da Etapa 5, que ficou parcial: o schema e as
 * primitivas existiam, mas nao havia por onde conectar um canal nem como ver
 * que ele estava com problema.
 *
 * A tela nao grava `credentials`: a coluna nao tem GRANT de escrita para
 * `authenticated`. A conexao passa por /api/canais/provisionar, que cria a
 * subconta Twilio e cifra o token no servidor.
 */

const CANAIS: { valor: string; rotulo: string; ajuda: string }[] = [
  { valor: 'whatsapp', rotulo: 'WhatsApp', ajuda: 'Cria uma subconta Twilio automaticamente. Para testar, use o número do Sandbox.' },
  { valor: 'instagram', rotulo: 'Instagram Direct', ajuda: 'Informe o ID da conta profissional.' },
  { valor: 'messenger', rotulo: 'Facebook Messenger', ajuda: 'Informe o ID da página.' },
  { valor: 'telegram', rotulo: 'Telegram', ajuda: 'Informe o identificador do bot.' },
  { valor: 'email', rotulo: 'E-mail compartilhado', ajuda: 'Informe o endereço da caixa.' },
  { valor: 'webchat', rotulo: 'Webchat', ajuda: 'Identificador do site que hospeda o chat.' },
  { valor: 'sms', rotulo: 'SMS', ajuda: 'Número no formato internacional.' },
];

const SANDBOX = '+14155238886';

const ROTULO_EVENTO: Record<string, string> = {
  quality_drop: 'Queda de qualidade',
  ban_risk: 'Risco de bloqueio',
  reconnect_needed: 'Precisa reconectar',
};

const ROTULO_STATUS: Record<string, string> = {
  active: 'Conectado',
  quality_issue: 'Com problema de qualidade',
  disconnected: 'Desconectado',
};

export default function CanaisPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [workspaceId, setWorkspaceId] = useState('');
  const [contas, setContas] = useState<any[]>([]);
  const [eventos, setEventos] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [numeros, setNumeros] = useState<any[]>([]);

  const [canal, setCanal] = useState('whatsapp');
  const [nome, setNome] = useState('');
  const [externo, setExterno] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    const { data: ws } = await supabase
      .from('workspaces').select('id').eq('slug', params.slug).maybeSingle();
    if (!ws) return;
    setWorkspaceId(ws.id);

    // `credentials` não entra no select: a coluna não tem GRANT de leitura
    // para authenticated, e pedir por ela derrubaria a consulta inteira.
    const [{ data: cs }, { data: ev }, { data: tp }, { data: nm }] = await Promise.all([
      supabase.from('channel_accounts')
        .select('id, channel_type, external_account_id, display_name, status, created_at')
        .order('created_at', { ascending: false }),
      supabase.from('channel_quality_events')
        .select('*').order('created_at', { ascending: false }).limit(50),
      supabase.from('message_templates').select('*').order('name'),
      supabase.from('agent_numbers').select('*'),
    ]);

    setContas(cs ?? []);
    setEventos(ev ?? []);
    setTemplates(tp ?? []);
    setNumeros(nm ?? []);
  }, [params.slug, supabase]);

  useEffect(() => { void carregar(); }, [carregar]);

  async function conectar() {
    setErro(''); setAviso(''); setSalvando(true);

    try {
      const resposta = await fetch('/api/canais/provisionar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId, channelType: canal,
          displayName: nome.trim(),
          externalAccountId: externo.trim() || null,
        }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        setErro(dados.detalhe ? `${dados.erro}: ${dados.detalhe}` : dados.erro);
        return;
      }

      setAviso(
        dados.subcontaCriada
          ? 'Canal conectado. Subconta Twilio criada e credenciais gravadas cifradas.'
          : 'Canal conectado.'
      );
      setNome(''); setExterno('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falha de rede');
    } finally {
      setSalvando(false);
    }
  }

  async function adicionarNumero(contaId: string, numero: string) {
    const { error } = await supabase.from('agent_numbers')
      .insert({ channel_account_id: contaId, phone_number: numero });
    if (error) { setErro(error.message); return; }
    await carregar();
  }

  const ajuda = CANAIS.find((c) => c.valor === canal)?.ajuda ?? '';

  return (
    <main>
      <h1>Canais</h1>
      <p className="lede">
        Conecte um canal, acompanhe a saúde de cada conta e veja o estado de aprovação dos
        templates. O número é corporativo e operado pela plataforma.
      </p>

      <div className="painel">
        <h2>Conectar canal</h2>

        <div className="form-linha">
          <label className="field">
            <span>Canal</span>
            <select value={canal} onChange={(e) => setCanal(e.target.value)}>
              {CANAIS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
            </select>
          </label>

          <label className="field">
            <span>Nome de exibição</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Comercial · Matrícula EAD" />
          </label>

          <label className="field">
            <span>{canal === 'whatsapp' ? 'Número de origem' : 'Identificador no provedor'}</span>
            <input
              value={externo}
              onChange={(e) => setExterno(e.target.value)}
              placeholder={canal === 'whatsapp' ? SANDBOX : 'ID da conta'}
            />
          </label>
        </div>

        <p className="muted">{ajuda}</p>

        {canal === 'whatsapp' && (
          <div className="empty" style={{ marginBottom: '1rem' }}>
            <p style={{ margin: 0 }}>
              Ao conectar, uma <strong>subconta Twilio</strong> é criada automaticamente e o token
              dela é gravado cifrado. A tela nunca vê essa credencial.
            </p>
            <p className="muted" style={{ margin: '0.5rem 0 0' }}>
              Para testar sem WABA: use o número do Sandbox <span className="mono">{SANDBOX}</span> e
              envie <span className="mono">join &lt;palavra&gt;</span> a partir do seu WhatsApp, conforme o
              painel da Twilio. A WABA do cliente final entra depois, por este mesmo fluxo.
            </p>
            <button
              className="secundario"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setExterno(SANDBOX)}
            >
              Usar número do Sandbox
            </button>
          </div>
        )}

        <div className="acoes">
          <button onClick={conectar} disabled={!nome.trim() || !workspaceId || salvando}>
            {salvando ? 'Conectando…' : 'Conectar canal'}
          </button>
        </div>

        {erro && <p className="error">{erro}</p>}
        {aviso && <p className="notice">{aviso}</p>}
      </div>

      <h2>Contas conectadas</h2>
      {contas.length === 0 ? (
        <div className="empty"><p style={{ margin: 0 }}>Nenhum canal conectado ainda.</p></div>
      ) : (
        <ul className="card-list">
          {contas.map((c) => {
            const eventosDaConta = eventos.filter((e) => e.channel_account_id === c.id);
            const numerosDaConta = numeros.filter((n) => n.channel_account_id === c.id);

            return (
              <li key={c.id} className="card">
                <span className="card-slug">{c.channel_type}</span>
                <p className="card-name">{c.display_name}</p>

                <div className="meta">
                  <span className={c.status === 'active' ? '' : 'falhou'}>
                    {ROTULO_STATUS[c.status] ?? c.status}
                  </span>
                  <span>{c.external_account_id ?? 'sem identificador'}</span>
                  <span>{numerosDaConta.length} número(s)</span>
                </div>

                {eventosDaConta.length > 0 && (
                  <ul className="historico">
                    {eventosDaConta.slice(0, 5).map((e) => (
                      <li key={e.id}>
                        <span className="etiqueta alerta">{ROTULO_EVENTO[e.event_type] ?? e.event_type}</span>{' '}
                        {e.detail ?? '—'}
                        <span className="muted"> · {new Date(e.created_at).toLocaleString('pt-BR')}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="inline-form" style={{ marginTop: '0.6rem' }}>
                  <input
                    placeholder="+55619..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        adicionarNumero(c.id, (e.target as HTMLInputElement).value);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                  <span className="muted">número do agente · Enter para adicionar</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2>Diagnóstico</h2>

      <div className="grade">
        <div className="card metrica">
          <span className="metrica-total">{contas.filter((c) => c.status === 'active').length}</span>
          <span className="metrica-rotulo">Canais conectados</span>
        </div>
        <div className="card metrica">
          <span className="metrica-total">{contas.filter((c) => c.status !== 'active').length}</span>
          <span className="metrica-rotulo">Precisam de atenção</span>
        </div>
        <div className="card metrica">
          <span className="metrica-total">{eventos.length}</span>
          <span className="metrica-rotulo">Eventos de qualidade</span>
        </div>
        <div className="card metrica">
          <span className="metrica-total">
            {templates.filter((t) => t.approval_status === 'approved').length}/{templates.length}
          </span>
          <span className="metrica-rotulo">Templates aprovados</span>
        </div>
      </div>

      {templates.length > 0 && (
        <div className="tabela-rolagem" style={{ marginTop: '1.5rem' }}>
          <table className="tabela">
            <thead><tr><th>Template</th><th>Categoria</th><th>Aprovação</th><th>Conteúdo</th></tr></thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{t.category ?? '—'}</td>
                  <td>
                    <span className={`etiqueta ${t.approval_status === 'approved' ? '' : 'alerta'}`}>
                      {t.approval_status}
                    </span>
                  </td>
                  <td className="muted">{String(t.body).slice(0, 60)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {eventos.length === 0 && (
        <p className="muted" style={{ marginTop: '1rem' }}>
          Nenhum evento de qualidade registrado. Quedas de qualidade, risco de bloqueio e pedidos de
          reconexão aparecem aqui assim que o provedor os reportar.
        </p>
      )}
    </main>
  );
}
