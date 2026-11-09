# Seek by Convertt

Next.js build of the "Seek by Convertt – Product Updated" prototype: a Slack-style team chat with
client spaces, decisions, meetings, AI agents and apps.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build && npm start
```

## Routes

- `/` — product flow review: the ten screens with notes, desktop/mobile device frame, ← → and D / M shortcuts
- `/app` — the Seek app itself, full screen. Deep-link a screen with a hash:
  `#signup` `#setup` `#channels` `#dms` `#invite` `#client` `#schedule` `#decisions` `#agents` `#apps`

The review page frames `/app` and the two stay in sync both ways.

## Structure

- `app/(review)/` — review page (own root layout + `review.css`)
- `app/(seek)/` — app page (own root layout + `seek.css`, the prototype's stylesheet unchanged)
- `app/fonts.css`, `public/fonts/` — Outfit and Geist Mono, self-hosted
- `components/review/ReviewShell.tsx` — review UI, rewritten in React
- `components/SeekApp.tsx` — mounts the app and tears it down on unmount
- `lib/seek/engine.js` — the prototype's app logic, kept as-is apart from mount/unmount wiring and one bug fix
  (opening a thread on a message with no replies crashed the app)
- `lib/seek/steps.ts` — the ten review steps

## Desktop app (Electron)

`desktop/` wraps the same Seek app in a native window (Mac, Windows, Linux). It exports the Next.js
build to static files (`SEEK_DESKTOP=1`, see `next.config.mjs`) and serves them from a local
127.0.0.1 server, so it works offline and the web build on Vercel is unaffected.

```bash
cd desktop
npm install
npm start            # builds the web export and opens the app
npm run smoke        # headless check: loads the app and visits 7 screens
npm run dist:mac     # desktop/dist/Seek-<version>.dmg  (also dist:win, dist:linux)
```

Native extras: app menu with **Go** shortcuts (⌘/Ctrl+1–7 jump to Team, DMs, Client chat, Meetings,
Decisions, AI agents, Apps), remembered window size and position, single instance, external links open in
the system browser. Installers are unsigned; sign them with your own certificates before sharing widely.
