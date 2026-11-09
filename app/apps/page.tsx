import type { Metadata } from 'next';
import { AppsPage } from '@/components/seek/pages/AppsPages';

export const metadata: Metadata = { title: 'Apps and integrations' };

export default function Page() {
  return <AppsPage />;
}
