import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Horizonte CRM',
  description: 'CRM conversacional inmobiliario con agentes de IA sobre WhatsApp',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F6F8F8' },
    { media: '(prefers-color-scheme: dark)', color: '#0C1413' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="es"><body>{children}</body></html>;
}
