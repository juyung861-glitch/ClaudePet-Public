'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('importer', {
  job: () => ipcRenderer.invoke('importer:job'),
  done: (result) => ipcRenderer.send('importer:done', result),
});
