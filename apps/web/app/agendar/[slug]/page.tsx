'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Página pública de agendamento.
 *
 * Quem chega aqui não tem conta. Nada do tenant é exposto: a página lê pela
 * função `get_public_booking_page` e grava pela `create_public_booking`, as
 * duas com escopo restrito. As tabelas continuam fechadas para o papel
 * anônimo. Ver ADR-0016.
 */

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

interface Janela {
  day_of_week: number | null;
  date: string | null;
  start_time: string;
  end_time: string;
}

/** Expande as janelas em horários concretos dos próximos catorze dias. */
function gerarHorarios(janelas: Janela[], duracao: number): { iso: string; rotulo: string }[] {
  const saida: { iso: string; rotulo: string }[] = [];
  const agora = new Date();

  for (let d = 0; d < 14; d += 1) {
    const dia = new Date(agora);
    dia.setDate(agora.getDate() + d);
    const iso = dia.toISOString().slice(0, 10);

    for (const j of janelas) {
      const casa = j.date ? j.date === iso : j.day_of_week === dia.getDay();
      if (!casa) continue;

      const [hi, mi] = j.start_time.split(':').map(Number);
      const [hf, mf] = j.end_time.split(':').map(Number);
      const inicio = hi * 60 + mi;
      const fim = hf * 60 + mf;

      for (let m = inicio; m + duracao <= fim; m += duracao) {
        const quando = new Date(`${iso}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`);
        if (quando <= agora) continue;
        saida.push({
          iso: quando.toISOString(),
          rotulo: `${DIAS[quando.getDay()]} ${quando.toLocaleDateString('pt-BR')} · ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
        });
      }
    }
  }

  return saida.sort((a, b) => a.iso.localeCompare(b.iso)).slice(0, 40);
}

export default function AgendarPage({ params }: { params: { slug: string } }) {
  const supabase = createClient();

  const [pagina, setPagina] = useState<any>(null);
  const [carregando, setCarregando] = useState(true);
  const [escolhido, setEscolhido] = useState('');
  const [form, setForm] = useState({ nome: '', email: '', telefone: '', observacoes: '' });
  const [erro, setErro] = useState('');
  const [confirmado, setConfirmado] = useState(false);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_booking_page', { p_slug: params.slug });
      if (!error && data && data.length > 0) setPagina(data[0]);
      setCarregando(false);
    })();
  }, [params.slug, supabase]);

  const horarios = useMemo(
    () => (pagina ? gerarHorarios(pagina.slots ?? [], pagina.default_duration_minutes) : []),
    [pagina]
  );

  async function reservar() {
    setErro('');
    const { error } = await supabase.rpc('create_public_booking', {
      p_slug: params.slug,
      p_starts_at: escolhido,
      p_nome: form.nome,
      p_email: form.email || null,
      p_telefone: form.telefone || null,
      p_observacoes: form.observacoes || null,
      p_criar_negocio: false,
    });

    if (error) {
      // Mensagem do banco em linguagem de quem está agendando.
      setErro(
        error.message.includes('indisponivel') ? 'Esse horário acabou de ser ocupado. Escolha outro.'
        : error.message.includes('fora das janelas') ? 'Esse horário não está mais disponível.'
        : 'Não foi possível concluir a reserva. Tente outro horário.'
      );
      return;
    }

    setConfirmado(true);
  }

  if (carregando) {
    return <main><p className="muted">Carregando…</p></main>;
  }

  if (!pagina) {
    return (
      <main>
        <h1>Página não encontrada</h1>
        <p className="lede">Confira o link com quem te enviou.</p>
      </main>
    );
  }

  if (confirmado) {
    return (
      <main>
        <p className="eyebrow">Kommo++</p>
        <h1>Encontro marcado</h1>
        <p className="lede">
          {new Date(escolhido).toLocaleString('pt-BR')} · {pagina.default_duration_minutes} minutos.
          {form.email && ` Uma confirmação chega em ${form.email}.`}
        </p>
      </main>
    );
  }

  return (
    <main>
      <p className="eyebrow">Agendamento</p>
      <h1>{pagina.title}</h1>
      <p className="lede">Escolha um horário de {pagina.default_duration_minutes} minutos.</p>

      {horarios.length === 0 ? (
        <div className="empty">
          <p style={{ margin: 0 }}>Nenhum horário livre nos próximos dias.</p>
        </div>
      ) : (
        <div className="grade-horarios">
          {horarios.map((h) => (
            <button
              key={h.iso}
              className={escolhido === h.iso ? '' : 'secundario'}
              onClick={() => setEscolhido(h.iso)}
            >
              {h.rotulo}
            </button>
          ))}
        </div>
      )}

      {escolhido && (
        <div className="painel" style={{ marginTop: '1.5rem' }}>
          <h2>Seus dados</h2>
          <div className="form-linha">
            <label className="field"><span>Nome</span>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
            <label className="field"><span>E-mail</span>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="field"><span>Telefone</span>
              <input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></label>
          </div>
          <label className="field largo"><span>Assunto</span>
            <textarea rows={3} value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></label>
          <div className="acoes">
            <button onClick={reservar} disabled={!form.nome.trim()}>Confirmar horário</button>
          </div>
          {erro && <p className="error">{erro}</p>}
        </div>
      )}
    </main>
  );
}
