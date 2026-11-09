import type { Metadata } from 'next';
import { DmsPage } from '@/components/seek/pages/DmsPage';

export const metadata: Metadata = { title: 'Direct messages' };

export default function Page() {
  return <DmsPage />;
}
