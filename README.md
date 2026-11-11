# Seek by Convertt

Seek is a Slack-style team chat for agencies. It has team channels, DMs, a private space for each client, a
decision log, meeting scheduling, AI agents and connected apps. It is built with Next.js and React, and it also
ships as a desktop app (Electron) for Mac, Windows and Linux.

```bash
npm install
npm run dev     # http://localhost:3000
npm run build && npm start
```

## Screens

Every screen has its own URL, and you move between them inside the app: the left rail on desktop, the bottom
tab bar on phones, links and buttons on each screen, and the ⌘K / Ctrl+K search.

| URL | Screen |
| --- | --- |
| `/signup` | Create an account (Google, or work email + 6-digit code) |
| `/setup` | Organization setup: name, logo, time zone, team size, use; then invite the team by link or email |
| `/welcome` | Profile setup after first sign-in; where invite emails' Join button lands |
| `/join?c=…` | Join an organization with its invite link: email → 6-digit code → profile |
| `/channels` | Team channels, threads, reactions, mentions, tasks and decisions from messages |
| `/dms` | Direct messages with a profile panel |
| `/clients` | Client spaces: Client chat, Team notes, Status, Approvals, People |
| `/meetings` | Schedule a call with a client (opens over the client space) |
| `/invite` | Invite a client: send, email preview, client joins with a code |
| `/decisions` | Decision log with filters, edit history and CSV export |
| `/agents` | AI agents: on/off, pause all, activity log |
| `/apps` | Connected apps, posting tiers and install requests |

Opening `/` takes new visitors to sign-up and signed-in people to their channels. As in the product prototype,
every screen also opens directly by its URL, and the prototype's hash links work too (`/#client` opens
`/clients`, `/#schedule` opens `/meetings`). When Seek runs inside the prototype's review page, it follows that
page's `seekGo` messages and reports the screen it is on with `seekRoute`. The layout adapts to the
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
  `routes.ts`, `backend.ts` (Supabase sign-in and data)
- `supabase/migrations/` — the database, as SQL files run in order

## Backend (Supabase)

Seek runs in two modes:

- **Demo mode** (no settings): no sign-in, every screen opens directly, sample data in the browser.
- **Backend mode**: set the two public settings below and people sign up with a 6-digit email code (or the
  sign-in link in Supabase's default email), create a workspace and invite teammates. Signed-out visitors go to
  sign-up. **Channels** are real: messages and thread replies are saved and arrive live for everyone in the
  workspace, new channels can be created, and **＋ Invite people** emails a sign-in code/link — the invited
  person joins the workspace the first time they sign in. DMs, Clients, Decisions, Agents and Apps are still sample
  data.

```bash
cp .env.example .env.local   # then fill in from Supabase → Project Settings → API Keys
```

| Setting | Where |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the **publishable** (or legacy *anon*) key — public by design |

On Vercel, add the same two settings under Project → Settings → Environment Variables and redeploy. Never use the
secret / `service_role` key in the app.

Setting up a new Supabase project:

1. SQL Editor → run each file in `supabase/migrations/` in order. Seek's tables go in their own `seek` schema, so
   they can share a project with other apps without touching `public`.
1. Integrations → Data API → Settings → Exposed schemas: add `seek`.
1. Authentication → Sign In / Providers → Email: set the email OTP length to **6**.
1. Authentication → URL Configuration: Site URL = the app's address; add `https://<app>/**` (and
   `http://localhost:3000/**` for development) to Redirect URLs.
1. Set up custom SMTP (we use Brevo). Then, under Authentication → Emails → Templates, paste the branded emails from
   `supabase/templates/`: `magic-link.html` into *Magic link or OTP*, `confirm-sign-up.html` into *Confirm sign
   up*, and `invite-user.html` into *Invite user* (subjects: "Your Seek sign-in code" and the invite subject
   below). The sender's domain must be authenticated with the SMTP
   provider (SPF/DKIM); otherwise mail to that same domain is rejected (e.g. convertt.co has DMARC `p=reject`).
1. Authentication → Rate Limits: "Minimum interval per user" **15** seconds (how soon one person can get another
   code; the app's Resend countdown matches it), sign-ins and code checks **60** per 5 minutes per IP (an office
   on one network can sign in together). Emails per hour is 3600; the real ceiling is the SMTP plan (Brevo free:
   300 emails a day).
1. Invites: Edge Functions → deploy `supabase/functions/seek-invite` and turn **off** "Verify JWT with legacy
   secret" (the function checks the caller itself; projects on the new ES256 signing keys need this). Then set the
   *Invite user* template's subject to `{{ .Data.invited_by }} invited you to {{ .Data.workspace }} on Seek`
   (its Join link, already in `invite-user.html`, is
   `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite&email={{ .Email }}`). The link opens
   `/welcome`, where the new teammate signs in, sets up their profile and lands in #general.

Each organization has a logo (stored in the public `seek-logos` bucket; only its admins can upload) and a secret
invite link (`/join?c=<code>`, shown under ＋ Invite people; admins can reset it). Invite emails carry both a Join
button and a 6-digit code, so if the button fails the person types the code instead of waiting for a new email.

**Organisation setup** (build spec 5.4): after sign-up and profile, three steps: organisation (logo cropped to a
square, name, workspace address checked on the server, brand colour, time zone, website), how the team works, then
invites (emails with Member/Admin each, the invite link, and "anyone with an @company email can join", never offered
for personal email providers). The brand colour becomes everyone's accent. If the person's company domain already
has a workspace that allows it, setup offers to join that one instead.

**Channel access:** a channel is open (everyone on the team) or private (only the people added, plus owners and
admins). New channels default to private. Invites can include private channels; people who join with the invite
link see open channels only until someone adds them. The database enforces it for channels, messages and search.

**Chat:** reactions are saved and live (several per person), you can delete your own messages (removed for everyone,
live), and read positions are saved, so unread badges are right after a reload or on another device. Tasks,
decisions, reminders and saving messages come with the Decisions milestone.

**Client spaces** (Clients → ＋ New): a four-step wizard (who the client is, their onboarding checklist, reply target
and tone, review and invite) creates the space and emails each client person a Join link. Clients sign in with a
code and see only their own project: a getting-started checklist, the Client chat and their team. The agency's team
sees Client chat, Team notes (never shown to the client), Status (both sides' checklist), Approvals and People
(roles, resend invite, remove). The database enforces the split: a client session never receives Team notes, team
channels or other clients. Decisions, meetings, agents, apps, files and approvals show empty states until those
features are built.

In backend mode the prototype's sample chats never show: the app starts empty and keeps only your own recent
chats in the browser, so a reload shows them at once while fresh ones load.

Everything is protected by row-level security: people only see workspaces they belong to and their teammates.

## Desktop app (Electron)

`desktop/` wraps the same app in a native window. It exports the Next.js build to static files
(`SEEK_DESKTOP=1`, see `next.config.mjs`) and serves them from a local 127.0.0.1 server, so it works offline and
the web build on Vercel is unaffected.

```bash
cd desktop
npm install
npm start            # builds the web export and opens the app
npm run smoke        # headless check: signs in, opens every screen, reloads
npm run dist:mac     # desktop/dist/Seek-<version>.dmg  (also dist:win, dist:linux)
```

Native extras: a **Go** menu (⌘/Ctrl+1–7 for Team, DMs, Clients, Schedule, Decisions, AI agents, Apps; Back and
Forward), remembered window size and position, single instance, and external links open in the system browser.
Installers are unsigned; sign them with your own certificates before sharing widely.
