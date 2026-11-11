import type { Metadata } from 'next';
import { WelcomePage } from '@/components/seek/pages/AuthPages';

export const metadata: Metadata = { title: 'Welcome' };

export default function Page() {
  return <WelcomePage />;
}
