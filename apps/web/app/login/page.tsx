'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

/**
 * Entrada por senha ou por link de e-mail.
 *
 * A senha existe porque o servidor de e-mail embutido do Supabase e limitado
 * e a entrega falha com frequencia — depender so do link deixa a plataforma
 * inacessivel quando o e-mail nao chega. Enquanto nao houver SMTP proprio, a
 * senha e o caminho confiavel.
 *
 * Mensagens de erro sao traduzidas: "Invalid login credentials" nao ajuda
 * ninguem a entender que errou a senha.
 */

type Modo = 'senha' | 'link';

const ERROS: Record<string, string> = {
  'Invalid login credentials': 'E-mail ou senha incorretos.',
  'Email not confirmed': 'Este e-mail ainda nao foi confirmado. Confirme pelo painel ou peca um novo link.',
  'Email logins are disabled': 'O acesso por e-mail esta desativado nas configuracoes do projeto.',
  'User already registered': 'Ja existe uma conta com este e-mail. Use a senha para entrar.',
};

function traduzir(mensagem: string): string {
  for (const [chave, texto] of Object.entries(ERROS)) {
    if (mensagem.includes(chave)) return texto;
  }
  if (/rate limit|too many/i.test(mensagem)) {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar de novo.';
  }
  return mensagem;
}

export default function LoginPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>('senha');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [estado, setEstado] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle');
  const [mensagem, setMensagem] = useState('');

  async function entrarComSenha() {
    setEstado('enviando'); setMensagem('');
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

    if (error) {
      setEstado('erro');
      setMensagem(traduzir(error.message));
      return;
    }

    // refresh() antes de navegar: o middleware precisa enxergar a sessao nova.
    router.refresh();
    router.push('/workspaces');
  }

  async function enviarLink() {
    setEstado('enviando'); setMensagem('');
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setEstado('erro');
      setMensagem(traduzir(error.message));
      return;
    }

    setEstado('enviado');
  }

  const podeEnviar = modo === 'senha'
    ? email.length > 4 && senha.length > 0
    : email.length > 4;

  return (
    <main>
      <p className="eyebrow">Kommo++ · VirtruvIA</p>
      <h1>Entrar na plataforma</h1>

      <div className="abas-login">
        <button
          className={`aba ${modo === 'senha' ? 'ativa' : ''}`}
          onClick={() => { setModo('senha'); setEstado('idle'); setMensagem(''); }}
        >
          Senha
        </button>
        <button
          className={`aba ${modo === 'link' ? 'ativa' : ''}`}
          onClick={() => { setModo('link'); setEstado('idle'); setMensagem(''); }}
        >
          Link por e-mail
        </button>
      </div>

      <p className="lede">
        {modo === 'senha'
          ? 'Informe o e-mail e a senha cadastrados.'
          : 'Enviamos um link de acesso válido por uma hora.'}
      </p>

      <label className="field">
        <span>E-mail</span>
        <input
          type="email"
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@empresa.com.br"
        />
      </label>

      {modo === 'senha' && (
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={senha}
            autoComplete="current-password"
            onChange={(e) => setSenha(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && podeEnviar) void entrarComSenha(); }}
          />
        </label>
      )}

      <button
        onClick={modo === 'senha' ? entrarComSenha : enviarLink}
        disabled={estado === 'enviando' || !podeEnviar}
      >
        {estado === 'enviando'
          ? 'Aguarde…'
          : modo === 'senha' ? 'Entrar' : 'Enviar link de acesso'}
      </button>

      {estado === 'enviado' && (
        <p className="notice">
          Link enviado para {email}. Se não chegar em alguns minutos, verifique o spam ou use a
          entrada por senha.
        </p>
      )}
      {estado === 'erro' && <p className="error">{mensagem}</p>}

      <hr className="rule" />
      <p className="muted">
        Ainda não tem conta? O cadastro é feito por quem administra o workspace. A criação de conta
        pela própria pessoa chega com o onboarding completo.
      </p>
    </main>
  );
}
