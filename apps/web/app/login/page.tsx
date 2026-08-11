'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function sendLink() {
    setState('sending');
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setState('error');
      setMessage(error.message);
      return;
    }

    setState('sent');
  }

  return (
    <main>
      <p className="eyebrow">Kommo++ · VirtruvIA</p>
      <h1>Entrar na plataforma</h1>
      <p className="lede">
        Informe o e-mail cadastrado. Enviamos um link de acesso valido por uma hora.
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

      <button onClick={sendLink} disabled={state === 'sending' || email.length < 5}>
        {state === 'sending' ? 'Enviando…' : 'Enviar link de acesso'}
      </button>

      {state === 'sent' && (
        <p className="notice">Link enviado para {email}. Abra o e-mail para continuar.</p>
      )}
      {state === 'error' && <p className="error">Nao foi possivel enviar: {message}</p>}
    </main>
  );
}
