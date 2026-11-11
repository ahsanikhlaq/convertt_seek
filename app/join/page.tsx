import type { Metadata } from 'next';
import { JoinPage } from '@/components/seek/pages/AuthPages';

export const metadata: Metadata = { title: 'Join your team' };

export default function Page() {
  return <JoinPage />;
}
