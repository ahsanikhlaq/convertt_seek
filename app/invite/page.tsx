import type { Metadata } from 'next';
import { InvitePage } from '@/components/seek/pages/InvitePage';

export const metadata: Metadata = { title: 'Invite a client' };

export default function Page() {
  return <InvitePage />;
}
