import type { Metadata } from 'next';
import { ChannelsPage } from '@/components/seek/pages/ChannelsPage';

export const metadata: Metadata = { title: 'Channels' };

export default function Page() {
  return <ChannelsPage />;
}
