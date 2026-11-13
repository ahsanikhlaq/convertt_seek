import type { Metadata } from 'next';
import { PeoplePage } from '@/components/seek/pages/PeoplePage';

export const metadata: Metadata = { title: 'People' };

export default function Page() {
  return <PeoplePage />;
}
