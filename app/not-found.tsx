import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty" style={{ height: '100%', display: 'grid', placeContent: 'center', gap: 12 }}>
      <b style={{ fontSize: 18, color: 'var(--ink)' }}>This page doesn&apos;t exist</b>
      <Link className="btn pri" href="/">
        Back to Seek
      </Link>
    </div>
  );
}
