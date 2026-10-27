'use client';

import { useEffect } from 'react';

/**
 * Hosts the Seek app. The engine renders every screen into #root and handles its own
 * routing (#signup, #channels, …), so React only provides the mount points and its lifecycle.
 */
export default function SeekApp() {
  useEffect(() => {
    let unmount: (() => void) | undefined;
    let cancelled = false;
    import('@/lib/seek/engine').then(({ mountSeekApp }) => {
      if (!cancelled) unmount = mountSeekApp();
    });
    return () => {
      cancelled = true;
      unmount?.();
    };
  }, []);

  return (
    <>
      <div id="root"></div>
      <div id="toast" role="status" aria-live="polite"></div>
    </>
  );
}
