const { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const STORE = () => path.join(app.getPath('userData'), 'notes.json');
const LT_LOCAL = 'http://127.0.0.1:8081/v2/check';
const LT_PUBLIC = 'https://api.languagetool.org/v2/check';

let notes = [];
let noteWins = new Map(); // id -> BrowserWindow
let hubWin = null;
let aboutWin = null;
let tray = null;
let dictionary = null; // lazy-loaded

function load() {
  try {
    notes = JSON.parse(fs.readFileSync(STORE(), 'utf-8').replace(/^﻿/, ''));
  } catch {
    notes = [];
  }
}

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = STORE() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(notes, null, 1));
    fs.renameSync(tmp, STORE());
  }, 300);
}

function summary() {
  return notes.map(n => ({
    id: n.id,
    preview: (n.text.trim().split('\n')[0] || 'A blank note').slice(0, 40),
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
    frame: false, resizable: true, skipTaskbar: true,
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
  win.on('closed', () => { noteWins.delete(n.id); tellHub(); });
  noteWins.set(n.id, win);
  tellHub();
  return win;
}

function newNote() {
  const count = notes.length;
  const disp = screen.getPrimaryDisplay().workArea;
  const n = {
    id: Date.now(),
    text: '',
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
  tray.on('click', () => createHub(true));
}

// ---------- IPC ----------
ipcMain.handle('note:get', (e, id) => notes.find(n => n.id === id) || null);

ipcMain.on('note:text', (e, id, text) => {
  const n = notes.find(n => n.id === id);
  if (!n) return;
  n.text = text; n.ts = Date.now();
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

ipcMain.on('note:close', (e, id) => { const w = noteWins.get(id); if (w) w.close(); });

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
ipcMain.on('win:close', e => { const w = BrowserWindow.fromWebContents(e.sender); if (w) w.close(); });
ipcMain.on('external', (e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });
ipcMain.on('app:quit', () => { app.isQuittingForReal = true; app.quit(); });

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
  app.on('second-instance', () => createHub(true));
  app.whenReady().then(() => {
    load();
    createTray();
    if (notes.length === 0) {
      notes = [{
        id: Date.now(),
        text: "Welcome to Write Notes! I'm a sticky note; drag me around by my top bar, pin me above other apps, and highlight some text to try the tools.",
        ts: Date.now(), x: undefined, y: undefined, w: 400, h: 340, pin: false
      }];
      save();
    }
    notes.forEach(n => createNoteWindow(n));
    createHub(false); // preload hidden so tray click is instant
  });
  app.on('window-all-closed', () => { /* stay alive in tray */ });
}
