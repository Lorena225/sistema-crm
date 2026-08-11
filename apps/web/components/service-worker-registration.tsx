'use client';

import { useEffect } from 'react';

/** Registra o service worker. Sem interface: so o efeito colateral. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Falha ao registrar nao pode quebrar a aplicacao: sem service worker
      // o app segue funcionando, apenas sem suporte offline.
    });
  }, []);

  return null;
}
