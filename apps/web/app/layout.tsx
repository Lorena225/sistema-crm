import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kommo++ VirtruvIA',
  description: 'CRM multi-tenant messenger-first da VirtruvIA.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
