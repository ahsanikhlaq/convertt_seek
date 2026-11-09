const { app, BrowserWindow, Menu, shell, nativeTheme, screen } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WEB_DIR = path.join(__dirname, 'web');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const SMOKE = process.argv.includes('--smoke-test');
const isMac = process.platform === 'darwin';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

/** Serves the exported Seek web build from 127.0.0.1 on a free port (Next's absolute /_next paths need a real origin). */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel;
      try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { rel = '/'; }
      let file = path.normalize(path.join(WEB_DIR, rel));
      if (file !== WEB_DIR && !file.startsWith(WEB_DIR + path.sep)) { res.writeHead(403).end(); return; }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { file = path.join(WEB_DIR, '404.html'); res.statusCode = 404; }
      res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    const visible = screen.getAllDisplays().some(d => {
      const b = d.workArea;
      return s.x >= b.x - 50 && s.y >= b.y - 50 && s.x < b.x + b.width && s.y < b.y + b.height;
    });
    return { width: s.width, height: s.height, ...(visible ? { x: s.x, y: s.y } : {}), maximized: !!s.maximized };
  } catch { return { width: 1280, height: 820 }; }
}

function saveState(win) {
  try {
    const maximized = win.isMaximized();
    const b = maximized ? (win._lastNormal || win.getBounds()) : win.getBounds();
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...b, maximized }));
  } catch {}
}

let server, origin, mainWindow;

/** Jumps to one of the app's ten screens; the engine listens for hash changes. */
function goTo(route) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`location.hash = ${JSON.stringify('#' + route)}`).catch(() => {});
}

function buildMenu() {
  const screens = [
    ['Team channels', 'channels'], ['Direct messages', 'dms'], ['Client chat', 'client'], ['Schedule a call', 'schedule'],
    ['Decisions', 'decisions'], ['AI agents', 'agents'], ['Apps and integrations', 'apps'],
  ];
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    { role: 'editMenu' },
    {
      label: 'Go',
      submenu: [
        { label: 'Sign up', click: () => goTo('signup') },
        { label: 'Workspace setup', click: () => goTo('setup') },
        { type: 'separator' },
        ...screens.map(([label, route], i) => ({ label, accelerator: `CmdOrCtrl+${i + 1}`, click: () => goTo(route) })),
        { type: 'separator' },
        { label: 'Invite a client', click: () => goTo('invite') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'Seek by Convertt', click: () => shell.openExternal('https://seek-mu.vercel.app') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const st = loadState();
  const win = new BrowserWindow({
    width: st.width, height: st.height, x: st.x, y: st.y, minWidth: 900, minHeight: 600,
    title: 'Seek by Convertt', show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1019' : '#ffffff',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
  });
  mainWindow = win;
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.on('move', () => { if (!win.isMaximized()) win._lastNormal = win.getBounds(); });
  win.on('resize', () => { if (!win.isMaximized()) win._lastNormal = win.getBounds(); });
  win.on('close', () => saveState(win));
  win.on('closed', () => { mainWindow = null; });

  // Keep the app inside its own origin; everything else opens in the system browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^(https?|mailto):/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('page-title-updated', e => { e.preventDefault(); });

  win.loadURL(`${origin}/app/`);
  return win;
}

async function smokeTest(win) {
  const wc = win.webContents;
  await new Promise(r => wc.once('did-finish-load', r));
  await new Promise(r => setTimeout(r, 800));
  const probe = async route => {
    await wc.executeJavaScript(`location.hash='#${route}'`);
    await new Promise(r => setTimeout(r, 300));
    return wc.executeJavaScript(`({route:'${route}',hash:location.hash,nodes:document.querySelectorAll('#root *').length,text:(document.querySelector('.main,.auth')||document.body).innerText.slice(0,60).replace(/\\n/g,' | ')})`);
  };
  const out = [];
  for (const r of ['signup', 'channels', 'dms', 'client', 'decisions', 'agents', 'apps']) out.push(await probe(r));
  const font = await wc.executeJavaScript(`document.fonts.check('16px Outfit')`);
  const img = await win.webContents.capturePage();
  const shot = process.env.SMOKE_SHOT;
  if (shot) fs.writeFileSync(shot, img.toPNG());
  console.log('SMOKE_RESULT ' + JSON.stringify({ url: wc.getURL(), title: win.getTitle(), font, screens: out }));
  const ok = out.every(o => o.nodes > 20 && o.hash === '#' + o.route);
  app.exit(ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock() && !SMOKE) {
  app.quit();
} else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    server = await startServer();
    origin = `http://127.0.0.1:${server.address().port}`;
    buildMenu();
    const win = createWindow();
    if (SMOKE) smokeTest(win).catch(e => { console.error('SMOKE_ERROR', e); app.exit(2); });
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
  app.on('will-quit', () => { try { server && server.close(); } catch {} });
}
