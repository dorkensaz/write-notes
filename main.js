const { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const STORE = () => path.join(app.getPath('userData'), 'notes.json');
const LT_LOCAL = 'http://127.0.0.1:8081/v2/check';
const LT_PUBLIC = 'https://api.languagetool.org/v2/check';

let notes = [];
let noteWins = new Map(); // id -> BrowserWindow
let hubWin = null;
let aboutWin = null;
let tray = null;
let dictionary = null; // lazy-loaded

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function load() {
  try {
    notes = JSON.parse(fs.readFileSync(STORE(), 'utf-8').replace(/^﻿/, ''));
  } catch {
    notes = [];
  }
  // migrate pre-rich-text notes (plain "text" field) into the "html" field
  notes.forEach(n => {
    if (n.html === undefined) n.html = escapeHtml(n.text || '').replace(/\n/g, '<br>');
  });
}

function plainPreview(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

let saveTimer;
function writeNow() {
  const tmp = STORE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 1));
  fs.renameSync(tmp, STORE());
}
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeNow, 300);
}
function saveNow() {
  clearTimeout(saveTimer);
  writeNow();
}

function summary() {
  return notes.map(n => ({
    id: n.id,
    preview: (plainPreview(n.html) || 'A blank note').slice(0, 40),
    ts: n.ts,
    open: noteWins.has(n.id)
  }));
}

function tellHub() {
  if (hubWin && !hubWin.isDestroyed()) hubWin.webContents.send('notes-changed', summary());
}

function onScreen(b) {
  // if the saved position fell off every display, recenter
  const hit = screen.getAllDisplays().some(d =>
    b.x + b.width > d.workArea.x + 24 && b.x < d.workArea.x + d.workArea.width - 24 &&
    b.y >= d.workArea.y - 8 && b.y < d.workArea.y + d.workArea.height - 24);
  return hit;
}

function createNoteWindow(n) {
  if (noteWins.has(n.id)) { const w = noteWins.get(n.id); w.show(); w.focus(); return w; }
  const bounds = { x: n.x, y: n.y, width: n.w || 360, height: n.h || 320 };
  const opts = {
    width: bounds.width, height: bounds.height,
    minWidth: 296, minHeight: 240,
    frame: false, resizable: true, skipTaskbar: false,
    backgroundColor: '#1C1C1C',
    alwaysOnTop: !!n.pin,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  };
  if (Number.isFinite(bounds.x) && onScreen(bounds)) { opts.x = bounds.x; opts.y = bounds.y; }
  const win = new BrowserWindow(opts);
  win.loadFile('note.html', { query: { id: String(n.id) } });
  let boundsTimer;
  const remember = () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      Object.assign(n, { x: b.x, y: b.y, w: b.width, h: b.height });
      save();
    }, 250);
  };
  win.on('move', remember);
  win.on('resize', remember);
  win.on('closed', () => {
    noteWins.delete(n.id);
    if (dictateOwner && dictateOwner.isDestroyed()) stopDictation(false); // don't leave the mic held
    tellHub();
  });
  noteWins.set(n.id, win);
  tellHub();
  return win;
}

function openMostRecent() {
  if (!notes.length) { newNote(); return; }
  const latest = notes.reduce((a, b) => (b.ts > a.ts ? b : a));
  createNoteWindow(latest);
}

function newNote() {
  const count = notes.length;
  const disp = screen.getPrimaryDisplay().workArea;
  const n = {
    id: Date.now(),
    html: '',
    ts: Date.now(),
    x: disp.x + 80 + (count % 8) * 40,
    y: disp.y + 80 + (count % 8) * 40,
    w: 360, h: 320, pin: false
  };
  notes.unshift(n);
  save();
  createNoteWindow(n);
}

function createHub(show = true) {
  if (hubWin && !hubWin.isDestroyed()) { if (show) { hubWin.show(); hubWin.focus(); } return; }
  hubWin = new BrowserWindow({
    width: 384, height: 560, minWidth: 336, minHeight: 400,
    frame: false, backgroundColor: '#141414',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  hubWin.loadFile('hub.html');
  hubWin.on('close', e => {
    // hide to tray instead of dying, unless the whole app is quitting
    if (!app.isQuittingForReal) { e.preventDefault(); hubWin.hide(); }
  });
  if (!show) hubWin.once('ready-to-show', () => hubWin.hide());
}

function createAbout() {
  if (aboutWin && !aboutWin.isDestroyed()) { aboutWin.show(); aboutWin.focus(); return; }
  aboutWin = new BrowserWindow({
    width: 424, height: 640, minWidth: 360, minHeight: 480,
    frame: false, backgroundColor: '#141414',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  aboutWin.loadFile('about.html');
  aboutWin.on('closed', () => { aboutWin = null; });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Write Notes (VA Tools PH)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'New note', click: newNote },
    { label: 'Show all notes', click: () => { notes.forEach(n => createNoteWindow(n)); } },
    { label: 'Open Write Notes hub', click: () => createHub(true) },
    { type: 'separator' },
    { label: 'More tools', click: createAbout },
    { type: 'separator' },
    { label: 'Quit Write Notes', click: () => { app.isQuittingForReal = true; app.quit(); } }
  ]));
  tray.on('click', () => openMostRecent());
}

// ---------- IPC ----------
ipcMain.handle('note:get', (e, id) => notes.find(n => n.id === id) || null);

ipcMain.on('note:content', (e, id, html) => {
  const n = notes.find(n => n.id === id);
  if (!n) return;
  n.html = html; n.ts = Date.now();
  save(); tellHub();
});

ipcMain.handle('note:pin', (e, id, pin) => {
  const n = notes.find(n => n.id === id);
  const w = noteWins.get(id);
  if (!n || !w) return false;
  n.pin = pin; save();
  w.setAlwaysOnTop(pin, 'floating');
  return w.isAlwaysOnTop();
});

ipcMain.on('note:close', (e, id) => { saveNow(); const w = noteWins.get(id); if (w) w.close(); });

ipcMain.on('note:delete', (e, id) => {
  const w = noteWins.get(id);
  if (w) w.close();
  notes = notes.filter(n => n.id !== id);
  save(); tellHub();
});

ipcMain.on('note:new', newNote);
ipcMain.on('note:focus', (e, id) => { const n = notes.find(n => n.id === id); if (n) createNoteWindow(n); });
ipcMain.handle('notes:list', () => summary());
ipcMain.on('about:open', createAbout);
ipcMain.on('hub:open', () => createHub(true));
ipcMain.on('win:close', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
ipcMain.on('external', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('app:quit', () => { app.isQuittingForReal = true; app.quit(); });

// ---------- dictation ----------
// The renderer never touches the mic. A helper process runs Whisper locally and streams
// one JSON line per event back here, which we relay to the note.
//
// Why not the browser's own API: Electron cannot use the Web Speech API at all.
// webkitSpeechRecognition dies with a `network` error (Electron ships no Google speech
// key) and Chromium's on-device path isn't bound in Electron, it kills the renderer.
// Windows' built-in SAPI recognizer was tried next and was not usable for dictation:
// "Hi. My name is Ken..." came back as "Scandals that I'm saying the exact since then".
//
// The helper is kept warm once started. Loading the Whisper models costs seconds, so
// respawning it per click would put that delay in front of every sentence; instead the
// mic is toggled by writing `start` / `stop` to its stdin.
let dictateProc = null;
let dictateOwner = null;

function dictateCommand() {
  const candidates = [
    // shipped: electron-builder drops the frozen helper beside the app's resources
    { cmd: path.join(process.resourcesPath || '', 'dictate', 'dictate.exe'), args: [] },
    // running from source, once the helper has been built locally
    { cmd: path.join(__dirname, 'dictate-dist', 'dictate', 'dictate.exe'), args: [] }
  ];
  for (const c of candidates) {
    if (c.cmd && fs.existsSync(c.cmd)) return c;
  }
  // running from source without a built helper: any Python that has faster-whisper
  const script = path.join(__dirname, 'dictate.py');
  const py = process.env.WN_PYTHON || path.join(__dirname, '..', 'AutoRecord', '.venv', 'Scripts', 'python.exe');
  return { cmd: py, args: [script] };
}

function killHelper() {
  if (!dictateProc) return;
  const p = dictateProc;
  dictateProc = null;
  try { p.stdin.write('quit\n'); } catch { /* already gone */ }
  try { p.kill(); } catch { /* already gone */ }
}

function stopDictation(notify = true) {
  const owner = dictateOwner;
  dictateOwner = null;
  if (dictateProc) {
    try { dictateProc.stdin.write('stop\n'); } catch { killHelper(); }
  }
  if (notify && owner && !owner.isDestroyed()) owner.send('dictate:event', { t: 'stopped' });
}

function ensureHelper() {
  if (dictateProc) return dictateProc;
  const { cmd, args } = dictateCommand();
  let proc;
  try {
    proc = spawn(cmd, args, { windowsHide: true });
  } catch {
    return null;
  }
  dictateProc = proc;

  let buf = '';
  proc.stdout.on('data', d => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        const msg = JSON.parse(s);
        if (proc === dictateProc && dictateOwner && !dictateOwner.isDestroyed()) dictateOwner.send('dictate:event', msg);
      } catch { /* not our protocol, ignore */ }
    }
  });
  proc.on('error', () => {
    if (proc !== dictateProc) return;
    dictateProc = null;
    if (dictateOwner && !dictateOwner.isDestroyed()) dictateOwner.send('dictate:event', { t: 'error', msg: 'helper failed to start' });
    dictateOwner = null;
  });
  proc.on('exit', () => {
    if (proc !== dictateProc) return;
    dictateProc = null;
    stopDictation();
  });
  return proc;
}

ipcMain.on('dictate:start', e => {
  const wc = e.sender;
  // one mic, so a second note taking over turns the first one's button off
  if (dictateOwner && dictateOwner !== wc && !dictateOwner.isDestroyed()) {
    dictateOwner.send('dictate:event', { t: 'stopped' });
  }
  dictateOwner = wc;
  const proc = ensureHelper();
  if (!proc) { wc.send('dictate:event', { t: 'error', msg: 'spawn failed' }); dictateOwner = null; return; }
  try { proc.stdin.write('start\n'); } catch { wc.send('dictate:event', { t: 'error', msg: 'helper not accepting commands' }); }
});

ipcMain.on('dictate:stop', () => stopDictation(false));

app.on('before-quit', () => { dictateOwner = null; killHelper(); });

ipcMain.handle('define', (e, word) => {
  if (!dictionary) {
    dictionary = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets', 'dictionary.json'), 'utf-8'));
  }
  const w = String(word || '').trim().toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
  return { word: w, definition: dictionary[w] || null };
});

ipcMain.handle('grammar', async (e, text) => {
  const body = new URLSearchParams({ text, language: 'en-US' });
  for (const url of [LT_LOCAL, LT_PUBLIC]) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const resp = await fetch(url, { method: 'POST', body, signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) continue;
      const result = await resp.json();
      let corrected = text;
      for (const m of result.matches.sort((a, b) => b.offset - a.offset)) {
        if (!m.replacements || !m.replacements.length) continue;
        corrected = corrected.slice(0, m.offset) + m.replacements[0].value + corrected.slice(m.offset + m.length);
      }
      return { corrected, source: url === LT_LOCAL ? 'local' : 'public' };
    } catch { /* try next */ }
  }
  return { error: true };
});

// ---------- lifecycle ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => openMostRecent());
  app.whenReady().then(() => {
    load();
    createTray();
    if (notes.length === 0) {
      notes = [{
        id: Date.now(),
        html: "Welcome to Write Notes! I'm a sticky note; drag me around by my top bar, pin me above other apps, and highlight some text to try the tools.",
        ts: Date.now(), x: undefined, y: undefined, w: 400, h: 340, pin: false
      }];
      save();
    }
    openMostRecent(); // don't flood the screen with every saved note on launch
    createHub(false); // preload hidden so tray click is instant
  });
  app.on('window-all-closed', () => { /* stay alive in tray */ });
}
