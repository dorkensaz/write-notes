const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getNote: id => ipcRenderer.invoke('note:get', id),
  setContent: (id, html) => ipcRenderer.send('note:content', id, html),
  setPin: (id, pin) => ipcRenderer.invoke('note:pin', id, pin),
  closeNote: id => ipcRenderer.send('note:close', id),
  deleteNote: id => ipcRenderer.send('note:delete', id),
  newNote: () => ipcRenderer.send('note:new'),
  focusNote: id => ipcRenderer.send('note:focus', id),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  onNotesChanged: cb => ipcRenderer.on('notes-changed', (e, list) => cb(list)),
  openAbout: () => ipcRenderer.send('about:open'),
  openHub: () => ipcRenderer.send('hub:open'),
  closeWindow: () => ipcRenderer.send('win:close'),
  openExternal: url => ipcRenderer.send('external', url),
  quit: () => ipcRenderer.send('app:quit'),
  define: word => ipcRenderer.invoke('define', word),
  grammar: text => ipcRenderer.invoke('grammar', text)
});
