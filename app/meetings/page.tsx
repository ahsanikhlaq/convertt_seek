import type { Metadata } from 'next';
import { ClientPage } from '@/components/seek/pages/ClientPage';

export const metadata: Metadata = { title: 'Schedule a call' };

export default function Page() {
  return <ClientPage scheduling />;
}
