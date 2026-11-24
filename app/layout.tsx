import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AppFrame } from '@/components/seek/AppFrame';
import { PopoverProvider } from '@/components/seek/Popovers';
import { SeekProvider } from '@/lib/seek/store';
import './fonts.css';
import './seek.css';
import './seek-a11y.css';

// Inter: a clear, professional typeface made for screens (self-hosted by Next.js at build time)
const inter = Inter({ subsets: ['latin', 'latin-ext'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: { default: 'Seek by Convertt', template: '%s · Seek' },
  description: 'Team chat with client spaces, decisions, meetings, AI agents and apps.',
  applicationName: 'Seek',
  icons: { icon: '/icon.png', apple: '/icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // the on-screen keyboard shrinks the page, so the composer and dialogs stay above it
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3f0e40' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1d21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the theme toggles `dark` and colour tokens on <html> at runtime
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <SeekProvider>
          <PopoverProvider>
            <AppFrame>{children}</AppFrame>
          </PopoverProvider>
        </SeekProvider>
      </body>
    </html>
  );
}
