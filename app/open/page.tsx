import type { Metadata } from 'next';
import { OpenPage } from '@/components/seek/pages/OpenPage';

export const metadata: Metadata = { title: 'Opening message' };

export default function Page() {
  return <OpenPage />;
}
