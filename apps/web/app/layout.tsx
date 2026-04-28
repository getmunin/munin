import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Munin — agent-native business apps',
  description:
    'Open-source headless business app suite (Knowledge Base, Helpdesk, CRM) where the AI agent is the UI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
