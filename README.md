# Seek by Convertt

Seek is a Slack-style team chat for agencies. It has team channels, DMs, a private space for each client, a
decision log, meeting scheduling, AI agents and connected apps. It is built with Next.js and React, and it also
ships as a desktop app (Electron) for Mac, Windows and Linux.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build && npm start
```

## Sign in with Google

"Continue with Google" on `/signup` uses Google's own sign-in button (Google Identity Services). It needs one
setting, a public **OAuth Client ID**; without it the button explains that Google isn't set up and the email
sign-in still works.

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) pick or create a project, then
   set up the **OAuth consent screen** (app name *Seek*, support email, and add test users while it is in
   *Testing*).
2. **Create credentials → OAuth client ID → Web application.** Under **Authorized JavaScript origins** add every
   address Seek runs on, for example `http://localhost`, `http://localhost:3000` and your Vercel domain
   (`https://….vercel.app`, plus any custom domain). No redirect URIs are needed.
3. Put the Client ID in `.env.local` (see `.env.example`) and in Vercel's environment variables as
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, then restart `npm run dev` or redeploy.

The person's Google name and email become their Seek profile. Signing out and back in with the same Google
account skips workspace setup; a different account goes through setup. Seek has no backend yet, so the ID token
is only checked in the browser (issuer, audience, expiry, verified email); when a backend is added, verify the
token's signature there. The desktop app signs in by email, because Google doesn't accept its local
`127.0.0.1` address.

## Screens

Every screen has its own URL, and you move between them inside the app: the left rail on desktop, the bottom
tab bar on phones, links and buttons on each screen, and the ⌘K / Ctrl+K search.

| URL | Screen |
| --- | --- |
| `/signup` | Create an account (Google, or work email + 6-digit code) |
| `/setup` | Workspace setup: name, time zone, team size, use, teammate invites |
| `/channels` | Team channels, threads, reactions, mentions, tasks and decisions from messages |
| `/dms` | Direct messages with a profile panel |
| `/clients` | Client spaces: Client chat, Team notes, Status, Approvals, People |
| `/meetings` | Schedule a call with a client (opens over the client space) |
| `/invite` | Invite a client: send, email preview, client joins with a code |
| `/decisions` | Decision log with filters, edit history and CSV export |
| `/agents` | AI agents: on/off, pause all, activity log |
| `/apps` | Connected apps, posting tiers and install requests |

New visitors start at sign-up; signed-in people go straight to their channels. The layout adapts to the
window by itself: desktop shows rail, list, conversation and detail panel side by side; phones get a bottom tab
bar, a ☰ list drawer and full-screen panels.

Workspace data, theme, light/dark mode and custom emoji are saved in the browser (localStorage), so a reload
keeps everything. Profile → *Reset workspace data* starts over.

## Structure

- `app/` — one folder per route (`app/channels/page.tsx`, …), the root layout, `seek.css` (design system) and
  `fonts.css` (Outfit and Geist Mono, self-hosted from `public/fonts/`)
- `components/seek/pages/` — the screens
- `components/seek/` — shared pieces: `Shell` (rail, top bar, sidebar, header, panel), `Messages` (feed, message
  actions, composer with @mentions and emoji, threads), `Popovers` (emoji picker, theme), `Dialogs`, `AppFrame`
  (sign-in guard, ⌘K search, profile drawer, shortcuts)
- `lib/seek/` — `data.ts` (types and starting data), `store.tsx` (app state, saving, toasts), `theme.ts`,
  `routes.ts`

## Desktop app (Electron)

`desktop/` wraps the same app in a native window. It exports the Next.js build to static files
(`SEEK_DESKTOP=1`, see `next.config.mjs`) and serves them from a local 127.0.0.1 server, so it works offline and
the web build on Vercel is unaffected.

```bash
cd desktop
npm install
npm start            # builds the web export and opens the app
npm run smoke        # headless check: signs in by email, opens every screen, reloads
npm run dist:mac     # desktop/dist/Seek-<version>.dmg  (also dist:win, dist:linux)
```

Native extras: a **Go** menu (⌘/Ctrl+1–7 for Team, DMs, Clients, Schedule, Decisions, AI agents, Apps; Back and
Forward), remembered window size and position, single instance, and external links open in the system browser.
Installers are unsigned; sign them with your own certificates before sharing widely.
