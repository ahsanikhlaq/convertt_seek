import type { Metadata, Viewport } from 'next';
import '../fonts.css';
import './seek.css';

export const metadata: Metadata = {
  title: 'Seek by Convertt',
  description: 'Team chat with client spaces, decisions, meetings, AI agents and apps.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function SeekLayout({ children }: { children: React.ReactNode }) {
  return (
    // the app toggles `dark` on <html> itself, so React must not fight over its class
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
