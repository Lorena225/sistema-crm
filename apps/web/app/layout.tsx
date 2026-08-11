import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ServiceWorkerRegistration } from '@/components/service-worker-registration';

export const metadata: Metadata = {
  title: 'Kommo++ VirtruvIA',
  description: 'CRM multi-tenant messenger-first da VirtruvIA.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Kommo++', statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  themeColor: '#0b0b0c',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">{children}</div>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
