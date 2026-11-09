import type { Metadata, Viewport } from 'next';
import { AppFrame } from '@/components/seek/AppFrame';
import { PopoverProvider } from '@/components/seek/Popovers';
import { SeekProvider } from '@/lib/seek/store';
import './fonts.css';
import './seek.css';

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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#3f0e40' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1d21' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // the theme toggles `dark` and colour tokens on <html> at runtime
    <html lang="en" suppressHydrationWarning>
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
