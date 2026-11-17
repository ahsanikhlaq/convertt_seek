'use client';

/**
 * Notifications that reach you when you're not in Seek.
 *  · Push (phone and desktop): this device subscribes once you turn it on; the seek-notify server function sends
 *    to it when something needs you and you haven't had Seek open for a couple of minutes.
 *  · Delivery: after you send a message (and every few minutes while Seek is open) the app asks the server to
 *    deliver what's waiting, pushes now, and emails to people who have been away a while.
 */
import { backendOn, sb } from './backend';

export type PushState = 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

let reg: Promise<ServiceWorkerRegistration | null> | null = null;
/** Registers Seek's service worker (once). It doesn't ask for anything. */
export function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!supported()) return Promise.resolve(null);
  reg ??= navigator.serviceWorker.register('/sw.js').catch(() => null);
  return reg;
}

export async function pushState(): Promise<PushState> {
  // iPhones and iPads only allow it once Seek is added to the Home Screen
  if (isIOS() && !standalone()) return 'ios-install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const r = await registerWorker();
  const sub = await r?.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function call<T>(body: Record<string, unknown>): Promise<{ data?: T; error?: string }> {
  const { data, error } = await sb().functions.invoke('seek-notify', { body });
  if (error) {
    try {
      const j = await (error as { context?: Response }).context?.json();
      if (j?.error) return { error: j.error };
    } catch {}
    return { error: 'Couldn’t reach Seek. Check your connection' };
  }
  if (data?.error) return { error: data.error };
  return { data: data as T };
}

/** Asks for permission (must follow a click) and subscribes this device. Returns an error message, or null. */
export async function enablePush(): Promise<string | null> {
  const st = await pushState();
  if (st === 'ios-install') return 'On iPhone, first add Seek to your Home Screen (Share → Add to Home Screen), then turn this on from there';
  if (st === 'unsupported') return 'This browser can’t show notifications when Seek is closed';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'Notifications are blocked for Seek. Allow them in your browser’s site settings' : 'Notifications weren’t allowed';
  const r = await registerWorker();
  if (!r) return 'Couldn’t set up notifications on this device';
  await navigator.serviceWorker.ready;
  const k = await call<{ publicKey: string }>({ action: 'vapid' });
  if (!k.data) return k.error ?? 'Couldn’t set up notifications';
  let sub = await r.pushManager.getSubscription();
  // a subscription made with another key can't receive ours
  if (sub && sub.options.applicationServerKey) {
    const a = new Uint8Array(sub.options.applicationServerKey as ArrayBuffer);
    const b = keyBytes(k.data.publicKey);
    if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.data.publicKey) as BufferSource });
  const j = sub.toJSON();
  const { error } = await sb().rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: j.keys?.p256dh ?? '', p_auth: j.keys?.auth ?? '', p_ua: navigator.userAgent });
  return error ? 'Couldn’t save this device. Try again' : null;
}

export async function disablePush(): Promise<string | null> {
  const r = await registerWorker();
  const sub = await r?.pushManager.getSubscription();
  if (!sub) return null;
  await sb().from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
  return null;
}

export async function testPush(): Promise<string | null> {
  const r = await call<{ sent: number }>({ action: 'test' });
  return r.error ?? (r.data?.sent ? null : 'Couldn’t reach this device. Turn notifications off and on again');
}

// ---- delivery
let timer: ReturnType<typeof setTimeout> | null = null;
/** After sending: deliver the notifications it created (pushes now, emails for people away a while). */
export function notifyOut() {
  if (!backendOn) return;
  if (timer) clearTimeout(timer);
  // a moment later, so a burst of messages is one call
  timer = setTimeout(() => {
    timer = null;
    void call({ action: 'flush' });
  }, 1200);
}
