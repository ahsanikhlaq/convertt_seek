/* Types and starting data for the Seek app (carried over from the product prototype). */

/** The sample people, plus real accounts (keyed by user id) when a backend is connected. 'AH' is always you. */
export type PersonKey = 'AH' | 'SY' | 'MO' | 'ZA' | 'CH' | 'PR' | 'AI' | (string & {});
export type Person = { name: string; color: string; role: string; initials?: string };

export const PEOPLE: Record<PersonKey, Person> = {
  AH: { name: 'Ahsan', color: '#4b154a', role: 'Account lead' },
  SY: { name: 'Syed', color: '#6d4fc2', role: 'Designer' },
  MO: { name: 'Momina', color: '#b4531f', role: 'Developer' },
  ZA: { name: 'Zara', color: '#b0306a', role: 'Design intern' },
  CH: { name: 'Chris Hale', color: '#8a5300', role: 'Client · approver' },
  PR: { name: 'Priya Shah', color: '#966826', role: 'Client · copy' },
  AI: { name: 'Standup agent', color: '#5a48c0', role: 'AI' },
};

export type Reply = { who: PersonKey; time: string; text: string; task?: string };

export type ChatMessage = {
  kind: 'msg';
  id: number;
  who: PersonKey;
  time: string;
  text: string;
  ai?: boolean;
  client?: boolean;
  src?: string;
  file?: [string, string];
  after?: string;
  task?: string;
  rx?: Record<string, number>;
  myrx?: string | null;
  thread?: Reply[];
  saved?: boolean;
  flash?: boolean;
};
export type DecisionCard = {
  kind: 'dec';
  id: number;
  text: string;
  by: string;
  gold?: boolean;
  req?: boolean;
  flash?: boolean;
};
export type NewMarker = { kind: 'new'; id: number };
export type FeedItem = ChatMessage | DecisionCard | NewMarker;

export type Channel = { id: string; unread: number; desc: string; tier?: string };
export type DmThread = { last: string; unread: number; msgs: FeedItem[] };
export type Space = { id: string; name: string; desc: string; wait: string; color: string };
export type Decision = {
  id: number;
  t: string;
  by: string;
  where: string;
  time: string;
  type: 'dec' | 'appr';
  client?: boolean;
  old?: boolean;
  a: string;
  /** History lines shown on a replaced decision ("Fri 15:02 · … logged by Ahsan"). */
  hist?: string[];
};
export type Agent = { n: string; d: string; lv: string; sc: string; on: boolean; st: string };
export type App = { id: string; n: string; d: string; to: string; tier: string; c: string; by: string; acc: string; on: boolean };
export type AppRequest = { id: string; n: string; by: string; c: string };
export type Theme = { side: string; body: string; acc: string };
export type Mode = 'light' | 'dark' | 'system';
export type StatusKey = 'on' | 'mt' | 'fc' | 'aw';
export type CustomEmoji = { n: string; src: string };
export type WorkspaceId = 'C' | 'K';
export type ClientTab = 'Client chat' | 'Team notes' | 'Status' | 'Approvals' | 'People';

export type Workspace = { ch: string; channels: Channel[]; msgs: Record<string, FeedItem[]> };

export type State = {
  version: number;
  session: 'out' | 'setup' | 'in';
  email: string;
  ws: { name: string; tz: string; size: string; use: string[]; invites: string[] };
  wsId: WorkspaceId;
  workspaces: Record<WorkspaceId, Workspace>;
  dm: PersonKey;
  dms: Partial<Record<PersonKey, DmThread>>;
  inv: { step: 1 | 2 | 3; email: string; space: string; msg: string };
  cs: string;
  cTab: ClientTab;
  approval: 'open' | 'req' | 'done';
  replied: boolean;
  spaces: Space[];
  cmsgs: Record<'Client chat' | 'Team notes', FeedItem[]>;
  sched: { title: string; slot: number; tool: string; send: boolean; rec: boolean; agenda: string };
  meeting: { title: string; when: string; tool: string } | null;
  decs: Decision[];
  pauseAll: boolean;
  agents: Agent[];
  app: string;
  apps: App[];
  reqs: AppRequest[];
  seenNew: boolean;
  notif: string;
  status: { k: StatusKey; t: string };
  me: { name: string; title: string; tz: string; email: string; dnd: boolean };
  theme: Theme;
  mode: Mode;
  custom: CustomEmoji[];
  recentE: string[];
  uid: number;
};

export const WORKSPACES: Record<WorkspaceId, { name: string; sub: string }> = {
  C: { name: 'Convertt', sub: 'Team · 12 channels · your team only' },
  K: { name: 'Kites Studio', sub: 'Team · 4 channels · design collective' },
};

export const STATUSES: [StatusKey, string, string][] = [
  ['on', 'Available', '🟢'],
  ['mt', 'In a meeting', '📅'],
  ['fc', 'Focus time', '🎧'],
  ['aw', 'Away', '🌙'],
];

export const DEFAULT_THEME: Theme = { side: '#3f0e40', body: '#f8f3ea', acc: '#611f69' };

export const THEMES: Record<keyof Theme, [string, string][]> = {
  side: [['Aubergine', '#3f0e40'], ['Plum', '#4b154a'], ['Midnight', '#1b1f3b'], ['Forest', '#173d2e'], ['Ocean', '#0c3a56'], ['Espresso', '#3a2620'], ['Charcoal', '#25272b'], ['Lilac', '#efe3f0']],
  body: [['Cream', '#f8f3ea'], ['Sand', '#f2eadc'], ['Ivory', '#fbf8f1'], ['Blush', '#f8eeef'], ['Sage', '#eef3ec'], ['Mist', '#edf2f5']],
  acc: [['Aubergine', '#611f69'], ['Berry', '#9c2a6b'], ['Teal', '#0a6b6b'], ['Ocean', '#1264a3'], ['Forest', '#1f6b45'], ['Amber', '#a15c00'], ['Coral', '#c4473a'], ['Ink', '#2b2f36']],
};

export const EMOJI: Record<string, string[]> = {
  Smileys: ['😀', '😃', '😄', '😁', '😂', '🤣', '😊', '🙂', '😉', '😍', '😘', '😎', '🤩', '🥳', '🤔', '🤨', '😐', '😅', '😬', '😴', '😮', '😢', '😭', '😡', '🤯', '🥲', '🫡', '🤗'],
  Gestures: ['👍', '👎', '👏', '🙌', '🙏', '💪', '👋', '🤝', '✌️', '🤞', '👀', '🫶', '👌', '☝️'],
  Work: ['✅', '❌', '⚠️', '💡', '🚀', '📌', '📎', '🗓️', '⏰', '📈', '📉', '🧪', '🐛', '🔒', '💬', '📣', '🎯', '🧩', '🛠️', '📝'],
  Fun: ['🔥', '🎉', '❤️', '💜', '⭐', '✨', '🍕', '☕', '🎂', '🌈', '🏆', '💯'],
};

export const SLOTS: [string, string, string][] = [
  ['Today', '15:00 Lahore', '11:00 London'],
  ['Tomorrow', '14:00 Lahore', '10:00 London'],
  ['Wed 14 Oct', '16:00 Lahore', '12:00 London'],
];
export const SLOT_LABELS = ['Today 15:00', 'Tomorrow 14:00', 'Wed 14 Oct 16:00'];

const m = (o: Omit<ChatMessage, 'kind'>): ChatMessage => ({ kind: 'msg', ...o });

export const STATE_VERSION = 1;

export function initialState(): State {
  return {
    version: STATE_VERSION,
    session: 'out',
    email: 'ahsan@convertt.co',
    ws: { name: 'Convertt', tz: 'Lahore (GMT+5)', size: '1–10', use: ['Team chat', 'Client work'], invites: ['syed@convertt.co', 'momina@convertt.co'] },
    wsId: 'C',
    workspaces: {
      C: {
        ch: 'launch-squad',
        channels: [
          { id: 'launch-squad', unread: 3, desc: 'Website relaunch, day to day · 6 members' },
          { id: 'design', unread: 0, desc: 'Visual design · 4 members' },
          { id: 'dev-team', unread: 0, desc: 'Builds and deploys · 3 members', tier: 'Digest' },
          { id: 'studio', unread: 0, desc: 'Studio life · 9 members', tier: 'Digest' },
          { id: 'general', unread: 0, desc: 'Everyone · announcements' },
        ],
        msgs: {
          'launch-squad': [
            m({ id: 1, who: 'AI', time: '09:30', ai: true, text: 'Standup · Monday\nDone: inner pages, copy final.\nToday: build and QA.\nBlocked: Safari menu bug, now a task for Momina.', src: 'Based on 9 messages · View sources' }),
            m({ id: 2, who: 'SY', time: '09:41', text: 'Who can take the Safari menu bug today? Launch is Wednesday.', rx: { '+1': 2 }, thread: [{ who: 'MO', time: '09:48', text: "I'll take it, it's the sticky header." }, { who: 'AH', time: '09:52', text: 'Thanks. Made it a task, due today 16:00.', task: 'Safari menu bug · Momina · today' }] }),
            { kind: 'new', id: 5 },
            m({ id: 3, who: 'MO', time: '10:05', text: "Staging is green again. Here's the homepage on Safari:", file: ['staging-home.png', '1.2 MB · version 3'], after: 'Deploying a fix for the sticky header now.' }),
            m({ id: 4, who: 'SY', time: '10:12', text: "Let's move deploy to Thursday 11:00 so QA has a full day." }),
          ],
          design: [m({ id: 11, who: 'SY', time: 'Thu 16:40', text: 'Icon set is final: rounded, 2px stroke.' }), { kind: 'dec', id: 12, text: 'Icon set: rounded, 2px stroke', by: 'Logged by Syed in a huddle' }],
          'dev-team': [m({ id: 21, who: 'MO', time: '08:12', text: 'GitHub · 3 deploys overnight, all green.' })],
          studio: [m({ id: 31, who: 'ZA', time: 'Fri', text: 'Friday lunch is at 13:30 🍕' })],
          general: [m({ id: 41, who: 'AH', time: 'Mon', text: 'Welcome to Seek, everyone. Say hi in #random.' })],
        },
      },
      K: {
        ch: 'kites-general',
        channels: [
          { id: 'kites-general', unread: 2, desc: 'Kites Studio · everyone · 8 members' },
          { id: 'brand-lab', unread: 0, desc: 'Identity experiments · 4 members' },
          { id: 'freelance-pool', unread: 1, desc: 'Briefs for freelancers · 11 members' },
          { id: 'inspo', unread: 0, desc: 'Things we like' },
        ],
        msgs: {
          'kites-general': [
            m({ id: 901, who: 'ZA', time: '08:50', text: 'Morning Kites! Moodboard review at 11:00.' }),
            m({ id: 902, who: 'SY', time: '09:05', text: "I'll bring the three logo routes. @Zara can you print them?", rx: { '🔥': 3 } }),
          ],
          'brand-lab': [m({ id: 911, who: 'SY', time: 'Yesterday', text: 'Route B is growing on me.' })],
          'freelance-pool': [m({ id: 921, who: 'ZA', time: 'Mon', text: 'New brief: packaging for a tea brand, 2 weeks.' })],
          inspo: [m({ id: 931, who: 'ZA', time: 'Fri', text: 'Saved a few type specimens in Files.' })],
        },
      },
    },
    dm: 'MO',
    dms: {
      MO: {
        last: 'Pushed the fix. Can you check Safari?',
        unread: 1,
        msgs: [
          m({ id: 51, who: 'AH', time: '09:55', text: 'Thanks for grabbing the Safari bug. Shout if you need a second pair of eyes.' }),
          m({ id: 52, who: 'MO', time: '10:30', text: 'Pushed the fix. Can you check Safari on your phone?', file: ['safari-header-fix.mov', '8 MB · 0:14'], after: 'It was the sticky header fighting the cookie banner.' }),
          { kind: 'new', id: 54 },
          m({ id: 53, who: 'MO', time: '10:41', text: "Also: should we tell Hollow & Bright about the Thursday deploy, or wait until it's done?" }),
        ],
      },
      SY: { last: 'Can you join the pricing call at 15:30?', unread: 3, msgs: [m({ id: 61, who: 'SY', time: '11:20', text: 'Can you join the pricing call at 15:30?' })] },
      ZA: { last: 'Thanks for the feedback!', unread: 0, msgs: [m({ id: 71, who: 'AH', time: 'Fri', text: 'Great first pass on the icons.' }), m({ id: 72, who: 'ZA', time: 'Fri', text: 'Thanks for the feedback!' })] },
    },
    inv: { step: 1, email: 'chris@hollowbright.com', space: 'Hollow & Bright', msg: 'Hi Chris, welcome to your project space.' },
    cs: 'HB',
    cTab: 'Client chat',
    approval: 'open',
    replied: false,
    spaces: [
      { id: 'HB', name: 'Hollow & Bright', desc: 'Website relaunch', wait: '26h', color: '#8a5300' },
      { id: 'NL', name: 'Northline Legal', desc: 'Brand identity', wait: '5h', color: '#684068' },
      { id: 'AF', name: 'Acme Foods', desc: 'Packaging', wait: '40m', color: '#5c7c2b' },
      { id: 'OR', name: 'Orbit Retail', desc: 'Store rebuild', wait: 'onboarding', color: '#7a4b8c' },
    ],
    cmsgs: {
      'Client chat': [
        m({ id: 81, who: 'AH', time: 'Thu 14:40', text: 'Two hero options are attached. Option B keeps your heritage mark and works better on mobile.', file: ['hero-options.pdf', '2 options · 4 MB'] }),
        m({ id: 82, who: 'CH', time: 'Fri 09:12', client: true, text: 'Option B is the one. Can we see it on mobile before Wednesday?' }),
        { kind: 'dec', id: 85, gold: true, text: 'Hero direction: option B', by: 'Agreed by Chris in Client chat · not a formal approval', req: true },
        m({ id: 83, who: 'PR', time: 'Fri 11:02', client: true, text: 'Is launch still Wednesday morning?' }),
        m({ id: 84, who: 'MO', time: '11:20', text: "Yes, Wednesday 09:00 London. You'll get an email the moment it's live." }),
      ],
      'Team notes': [
        m({ id: 91, who: 'SY', time: 'Fri 09:20', text: "Chris picked B. I'll do the mobile pass today." }),
        m({ id: 92, who: 'AH', time: 'Fri 09:31', text: 'Watch scope: mobile hero animation was not in the SOW. Scope guard flagged it.' }),
      ],
    },
    sched: { title: 'Mobile review', slot: 0, tool: 'Google Meet', send: true, rec: true, agenda: 'Walk through hero option B on mobile, confirm Wednesday launch.' },
    meeting: null,
    decs: [
      { id: 1, t: 'Deploy moves to Thursday 11:00', by: "Logged by Ahsan from Syed's message", where: 'launch-squad', time: 'Mon 10:12', type: 'dec', a: 'Source message' },
      { id: 2, t: 'Hero direction: option B', by: 'Agreed by Chris in Client chat · formal approval pending', where: 'HB', time: 'Fri 09:12', type: 'appr', client: true, a: 'Source message' },
      { id: 3, t: 'Icon set: rounded, 2px stroke', by: 'Logged by Syed in a huddle', where: 'design', time: 'Thu 16:40', type: 'dec', a: 'Huddle notes' },
      { id: 4, t: 'Deploy on Wednesday 17:00', by: 'Replaced by "Deploy moves to Thursday 11:00" · history kept', where: 'launch-squad', time: 'Fri 15:02', type: 'dec', old: true, a: 'History', hist: ['Fri 15:02 · "Deploy on Wednesday 17:00" logged by Ahsan', 'Mon 10:12 · Replaced by "Deploy moves to Thursday 11:00"'] },
    ],
    pauseAll: false,
    agents: [
      { n: 'Summariser', d: 'Catch-up on Home and /summarize, with links to every source.', lv: 'Suggest only', sc: 'Team side', on: true, st: 'Ran 14 times today' },
      { n: 'Task suggester', d: 'Proposes tasks from messages. You accept or dismiss.', lv: 'Suggest only', sc: 'Team side', on: true, st: '3 suggestions today' },
      { n: 'Away assistant', d: 'Answers clients outside hours from client-visible content only.', lv: 'Asks before acting', sc: 'Client-visible only', on: true, st: 'Answered 4 overnight' },
      { n: 'Scope guard', d: 'Flags requests outside the accepted scope and drafts a change request.', lv: 'Suggest only', sc: 'Team side', on: true, st: '1 flag this week' },
      { n: 'Retainer watch', d: 'Warns in Team notes at 80% and 100% of a retainer.', lv: 'Suggest only', sc: 'Team side', on: true, st: 'Northline at 82%' },
      { n: 'Status drafter', d: 'Drafts the weekly client update for review.', lv: 'Asks before acting', sc: 'Client-visible only', on: false, st: 'Off' },
    ],
    app: 'GH',
    apps: [
      { id: 'GH', n: 'GitHub', d: 'Deploys, PRs, failed checks', to: '#dev-team', tier: 'Digest', c: '#2d262d', by: 'Momina · 3 Sep', acc: 'Read repos, post messages', on: true },
      { id: 'FG', n: 'Figma', d: 'File updates and comments', to: 'Team notes', tier: 'Digest', c: '#a259ff', by: 'Syed · 8 Sep', acc: 'Read files, post comments', on: true },
      { id: 'UP', n: 'Uptime', d: 'Site down alerts', to: '#dev-team', tier: 'Urgent', c: '#c0392b', by: 'Momina · 1 Sep', acc: 'Post alerts', on: true },
      { id: 'GC', n: 'Google Calendar', d: 'Huddles and meetings', to: 'Home', tier: 'Normal', c: '#c63cc4', by: 'Ahsan · 1 Sep', acc: 'Read and create events', on: true },
      { id: 'LN', n: 'Linear', d: 'Issue status changes', to: '#dev-team', tier: 'Digest', c: '#5e6ad2', by: 'Momina · 12 Sep', acc: 'Read issues', on: true },
      { id: 'XR', n: 'Xero', d: 'Invoices sent and paid', to: 'Team notes', tier: 'Digest', c: '#c736c4', by: 'Ahsan · 20 Sep', acc: 'Read invoices', on: true },
    ],
    reqs: [
      { id: 'ST', n: 'Stripe', by: 'Syed', c: '#635bff' },
      { id: 'LM', n: 'Loom', by: 'Momina', c: '#625df5' },
    ],
    seenNew: false,
    notif: 'Normal',
    status: { k: 'on', t: 'Available' },
    me: { name: 'Ahsan Raza', title: 'Account lead · Convertt', tz: 'Lahore (GMT+5)', email: 'ahsan@convertt.co', dnd: false },
    theme: DEFAULT_THEME,
    mode: 'light',
    custom: [],
    recentE: [],
    uid: 1000,
  };
}
