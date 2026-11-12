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
| `/setup` | Workspace setup on one screen: logo, name, time zone, team size, invite teammates |
| `/welcome` | Profile setup after first sign-in; where invite emails' Join button lands |
| `/join?c=…` | Join an organization with its invite link: email → 6-digit code → profile |
| `/channels` | Team channels, threads, reactions, mentions, tasks and decisions from messages |
| `/dms` | Direct messages with a profile panel |
| `/clients` | Client spaces: Client chat, Team notes, Status, Approvals, Files, People |
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
  person joins the workspace the first time they sign in. DMs, client spaces, decisions, approvals, files and
  notifications and meetings are real too; AI agents and apps are still sample screens.

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

**Workspace setup:** after the email code, a new owner gets one screen, as in the prototype: logo (optional, cropped
to a square), workspace name (its .seek.app address follows the name and is checked on the server), time zone, team
size and teammates to invite (type or paste emails). Continue to #general creates the workspace, sends the invites and
opens #general. The owner's name starts from their email and can be changed in the profile. If the person's company
domain already has a workspace that allows it, setup offers to join it. People in several organisations switch between
them from the rail.

**Invites to existing accounts:** someone who already has a Seek account gets an invite email too ("X invited you
to Y on Seek", with a Join button), not a bare sign-in code. The invite function marks the account with the invite
only while that email is written, and the *Magic link* template shows the invite version when it sees it.

**Channel access:** a channel is open (everyone on the team) or private (only the people added, plus owners and
admins). New channels default to private. Invites can include private channels; people who join with the invite
link see open channels only until someone adds them. The database enforces it for channels, messages and search.

**Chat:** reactions are saved and live (several per person), you can delete your own messages (removed for everyone,
live), and read positions are saved, so unread badges are right after a reload or on another device. Files: ＋ in
the message box (or drop files on it) shares up to 10 files of up to 100 MB each; images show a preview. Files live in
the private `seek-files` bucket under the conversation they were shared in, and storage only gives them (as links
that expire after an hour) to people who can see that conversation. Channels and client spaces have a Files tab.

**Message menu:** More (or a key while the menu is open) on any saved message: ☐ Make task (T: title, owner, due
date; the owner is notified and a task chip shows under the message), ◇ Log decision (D), ⏰ Remind me (R: in 20
minutes, 1 or 3 hours, tomorrow or next Monday at 09:00, or any time; it arrives in your 🔔 while Seek is open, or the
next time you open it), 📌 Pin (P, for everyone in the conversation; in client spaces only the team pins), ★ Save (S,
just for you), Copy text (L). The channels sidebar has **Tasks** (Mine, All open, Done; tick to finish, remind, open
the source message) and **Saved**. Channels also have a **Pins** tab and a **Canvas** tab: one shared page per channel
(brief, owners, key dates); if someone saved it while you were editing, your save stops and shows their version
instead of overwriting it. Tasks are team-only: clients never see them.

**More chat features:** ✎ Edit your own messages (E; only the text can change, marked "edited"). 🔗 Copy link (L) gives
a link (/open?m=…) that opens the message for anyone who can see its conversation. ⏱ Later sends a message at a set
time (Seek delivers it while it is open on one of your devices, or as soon as you next open it); Scheduled in the
channels sidebar lists and cancels them. Messages that fail to send stay in the conversation as "Not sent" with Retry
and Discard, and go by themselves when the connection is back; an offline banner shows while you are offline. DMs
have Files and Pins tabs; client spaces have a Pins tab (clients see Client chat pins). 🎧 Huddle (channels) and 📞 Call
(DMs) open a private Seek video room (a free Jitsi Meet room with a random name, no account needed) and post a card
others join from; the database only accepts such cards from people, so nobody can forge a meeting card or link.

**Notification sounds:** in the profile (and a client's Settings): six sounds with a preview, volume, which
notifications play it (all, only DMs/mentions/approvals, or none), and how long desktop alerts stay (4, 8, 15 seconds
or until closed). Pause and Focus still silence the rest.

**Profile and workspace:** upload a profile photo (✎ on your avatar in the profile drawer; cropped to 256px). Custom
emoji belong to the workspace (anyone on the team adds them; everyone, clients included, sees them). Your theme and
light/dark mode are saved to your account and follow you to other devices.

**Reply timer:** each client space shows how long the client has waited for a reply, in working hours (Mon–Fri,
09:00–18:00 in your time zone), from their first unanswered Client chat message until anyone on the team replies; red
once over the reply target. It shows in the clients list, the space's side panel, and the Status tab (with checklist
progress, next meeting and open approvals).

**Search (⌘K / Ctrl+K):** finds messages, files, decisions, people and client spaces (filter by kind), and opens the
result in place. It runs in the database as you, so a client never finds Team notes, team channels or other clients.

**AI agents:** the six agents from the spec with an on/off switch and permission level each (admins only; agents that
can reach clients never "Act" on their own), Pause all AI for everyone, and a log of every change. The agents run once
the AI connection (a Claude API key on the server) is added; until then the screen says so.

**Profiles and the client view:** pronouns and working hours on your profile (the DM profile panel shows them, with
the person's local time and status); your email-notification preference is saved for when email sending is set up.
Clients get Upcoming calls (Join, Add to calendar) and Settings (name, role, email preference, desktop alerts, sign
out). The reply timer uses the workspace's time zone.

**Security tests:** `supabase/tests/security_rules.sql` checks every access rule (35 checks: client isolation, Team
notes, files, search, approvals, decisions history, agents, outsiders). Paste it into the SQL Editor and run it after any
database change; it rolls everything back and prints e.g. "RESULT: 35 passed, 0 failed".

**Decisions:** any message's More menu → Log decision (or D) saves it with who logged it, where and the source
message; the decision card shows under the message, and Undo is offered for a few seconds. In the Decisions log you
filter by place and type, search, jump to the source message, edit (the new wording replaces the old, which stays in
History), remove your own, and export everything as CSV. A decision is visible to exactly the people who can see its
conversation: one from Client chat is gold and the client sees it; one from Team notes or a channel never reaches a
client.

**Notifications:** the database writes a notification for every DM, @mention (and @everyone/@here), thread reply,
client message and team reply in Client chat. The 🔔 shows them live with an unread count; clicking one opens the
conversation. Desktop alerts (when Seek is not in front) can be switched on from the list. Each channel can be Normal,
Digest or Mute (from its header; muted channels only notify mentions). Your status and "Pause notifications" are
saved to your account.

**Workspace settings** (profile → ⚙ Workspace settings): owners and admins change the name, logo, brand colour, invite
link and domain joining, change roles (Member/Admin), remove people, and resend or cancel invites. The owner can't be
removed or demoted. Everyone else sees it read-only.

**Client spaces** (Clients → ＋ New opens a pop-up): one simple invite: the client's email, the space name, an
optional welcome message, and who on your team works on this client. Send invite creates the space (the client is its
approver) and emails them "X invited you to <space>" with the welcome message, a Join button and a 6-digit code; Copy
invite link gives a link they open and sign in with that email. In the email, Join now opens the client's join
screen (as in the prototype): they enter the 6-digit code from the same email and land in their space, with no
profile step. More client people can be added from People. Clients
sign in with a code and see only their own project, starting on the conversation. The agency's team
sees Client chat, Team notes (never shown to the client), Status (both sides' checklist), Approvals, Files and People
(roles, resend invite, remove). The database enforces the split: a client session never receives Team notes (or
their files), team channels or other clients.

**Approvals:** from a space's Approvals tab (or "Request formal approval" on a Client chat decision) the team asks a
client *approver* who has joined to sign off something exact by a date. The approver gets a notification and, in
their space, big Approve / Request changes buttons (changes need a note). Approving records their name and time and
logs an approval in the decision log that nobody can edit or remove. The team can nudge once a day, send it again
after changes, or withdraw an open request. Clients see their approvals and files in their own view.

**Meetings:** ▤ Schedule (in a client space, or on the Meetings screen) books a call: who (the space's teammates
and joined client people), three suggested times inside everyone's working hours (Mon–Fri 09:00–17:30, shown in your
time and the client's, from their profile time zone) or any other time, length, Google Meet / Zoom (paste the link),
Seek video (a private Jitsi room is created) or in person, agenda, and whether to record. Sent to the client, it posts
a MEETING card in Client chat (they are notified); otherwise only in Team notes. The card has Join, Add to calendar
(an .ics file) and, for the team, Cancel. The Meetings screen lists what's coming up across all clients. Clients only
ever see meetings sent to them. Google Calendar availability and automatic Meet/Zoom links need the Apps integrations.

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
