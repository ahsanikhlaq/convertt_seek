import type { Metadata } from 'next';
import { TermsPage } from '@/components/seek/pages/LegalPages';

export const metadata: Metadata = { title: 'Terms of service' };

export default function Page() {
  return <TermsPage />;
}
