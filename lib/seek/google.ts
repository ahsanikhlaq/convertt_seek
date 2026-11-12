'use client';

/**
 * "Sign in with Google" using Google Identity Services (GIS).
 *
 * Only a public OAuth Client ID is needed (NEXT_PUBLIC_GOOGLE_CLIENT_ID); there is no client secret and no server
 * route, so this also works in the static desktop export. Google returns a signed ID token (JWT) for the account the
 * person picked; we read their name, email and photo from it.
 *
 * Seek keeps all data in the browser today, so the token is checked here (issuer, audience, expiry, verified email)
 * but not cryptographically. Once Seek has a backend, send the token there and verify its signature before trusting it.
 */

const desktop = process.env.NEXT_PUBLIC_SEEK_DESKTOP === '1';

/** Empty when Google sign-in is not configured (or in the desktop app, whose 127.0.0.1 origin Google won't accept). */
export const GOOGLE_CLIENT_ID = desktop ? '' : (process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '').trim();

export const GOOGLE_UNAVAILABLE = desktop
  ? 'Google sign-in is on the web version for now. Use your email below.'
  : "Google sign-in isn't set up yet. Use your email below.";

export type GoogleProfile = { sub: string; email: string; name: string; picture: string };

type CredentialResponse = { credential?: string };
type GoogleId = {
  initialize: (o: Record<string, unknown>) => void;
  renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
  disableAutoSelect: () => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client';
let loading: Promise<GoogleId> | null = null;

/** Loads Google's script once; rejects if it can't be reached. */
export function loadGoogle(): Promise<GoogleId> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GoogleId>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = SCRIPT;
    el.async = true;
    el.defer = true;
    el.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google script loaded without accounts.id')));
    el.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(el);
  }).catch((e) => {
    loading = null; // allow a retry later
    throw e;
  });
  return loading;
}

function decodePart(part: string): Record<string, unknown> {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** Reads the profile out of Google's ID token, or null if the token isn't one Google issued for this app just now. */
export function profileFromCredential(jwt: string | undefined): GoogleProfile | null {
  try {
    const parts = (jwt || '').split('.');
    if (parts.length !== 3) return null;
    const p = decodePart(parts[1]);
    const issuerOk = p.iss === 'accounts.google.com' || p.iss === 'https://accounts.google.com';
    const fresh = typeof p.exp === 'number' && p.exp * 1000 > Date.now();
    if (!issuerOk || p.aud !== GOOGLE_CLIENT_ID || !fresh) return null;
    if (typeof p.sub !== 'string' || typeof p.email !== 'string' || p.email_verified !== true) return null;
    return {
      sub: p.sub,
      email: p.email,
      name: typeof p.name === 'string' ? p.name : '',
      picture: typeof p.picture === 'string' ? p.picture : '',
    };
  } catch {
    return null;
  }
}

/**
 * Sets up Google's button inside `el`. `onCredential` gets each ID token Google returns.
 * Resolves once the button is drawn.
 */
export async function renderGoogleButton(el: HTMLElement, onCredential: (credential: string | undefined) => void) {
  const id = await loadGoogle();
  id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (r: CredentialResponse) => onCredential(r.credential),
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true,
    context: 'signin',
  });
  el.replaceChildren();
  id.renderButton(el, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text: 'continue_with',
    shape: 'rectangular',
    logo_alignment: 'center',
    width: Math.max(200, Math.min(400, Math.round(el.clientWidth || 400))),
  });
}

/** After signing out, stop Google from signing the same account straight back in. */
export function googleSignOut() {
  try {
    window.google?.accounts?.id?.disableAutoSelect();
  } catch {}
}
