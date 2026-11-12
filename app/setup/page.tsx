import type { Metadata } from 'next';
import { SetupPage } from '@/components/seek/pages/AuthPages';

export const metadata: Metadata = { title: 'Set up your workspace' };

export default function Page() {
  return <SetupPage />;
}
