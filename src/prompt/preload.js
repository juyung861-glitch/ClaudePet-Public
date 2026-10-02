'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petPrompt', {
  initial: () => ipcRenderer.invoke('prompt:initial'),
  submit: (text) => ipcRenderer.invoke('prompt:submit', String(text || '')),
  close: () => ipcRenderer.send('prompt:close'),
});
