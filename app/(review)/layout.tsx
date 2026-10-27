import type { Metadata, Viewport } from 'next';
import '../fonts.css';
import './review.css';

export const metadata: Metadata = {
  title: 'Seek by Convertt · Product flow review',
  description: 'Ten working screens of Seek, the client-ready team chat by Convertt, on desktop and mobile.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#3e133e' };

export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
