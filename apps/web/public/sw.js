/**
 * Service worker do Kommo++.
 *
 * Duas regras deliberadas:
 *
 * 1. Nada de API vai para cache. Guardar resposta de /api ou do Supabase
 *    significaria servir dado de tenant a partir do disco do aparelho, fora
 *    do alcance da RLS — inclusive depois de a pessoa perder acesso ao
 *    workspace. Dado operacional so vem da rede.
 * 2. O cache guarda apenas o casco da aplicacao (HTML de navegacao e
 *    estaticos), para que o app abra sem rede e a fila offline funcione.
 */

const VERSAO = 'kommopp-v1';
const CASCO = ['/offline', '/manifest.webmanifest'];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(CASCO)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evento) => {
  const { request } = evento;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Regra 1: API e autenticacao nunca entram em cache.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  if (request.mode === 'navigate') {
    // Rede primeiro; sem rede, o casco guardado.
    evento.respondWith(
      fetch(request)
        .then((resposta) => {
          const copia = resposta.clone();
          caches.open(VERSAO).then((cache) => cache.put(request, copia));
          return resposta;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/offline')))
    );
    return;
  }

  // Estaticos: cache primeiro, com atualizacao em segundo plano.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    evento.respondWith(
      caches.match(request).then(
        (guardada) =>
          guardada ||
          fetch(request).then((resposta) => {
            const copia = resposta.clone();
            caches.open(VERSAO).then((cache) => cache.put(request, copia));
            return resposta;
          })
      )
    );
  }
});
