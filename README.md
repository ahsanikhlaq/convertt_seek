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
