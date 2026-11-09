import type { Metadata } from 'next';
import { AgentsPage } from '@/components/seek/pages/AppsPages';

export const metadata: Metadata = { title: 'AI agents' };

export default function Page() {
  return <AgentsPage />;
}
