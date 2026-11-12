import type { Metadata } from 'next';
import { PrivacyPage } from '@/components/seek/pages/LegalPages';

export const metadata: Metadata = { title: 'Privacy policy' };

export default function Page() {
  return <PrivacyPage />;
}
