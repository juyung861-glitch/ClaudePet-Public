'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pet', {
  onLoad: listen('pet:load'),
  onDisplay: listen('pet:display'),
  onOneshot: listen('pet:oneshot'),
  onSequence: listen('pet:sequence'),
  onBubble: listen('pet:bubble'),
  onScale: listen('pet:scale'),
  onLook: listen('pet:look'),
  ready: () => ipcRenderer.send('renderer:ready'),
  setIgnore: (ignore) => ipcRenderer.send('mouse:ignore', !!ignore),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragMove: () => ipcRenderer.send('drag:move'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  click: () => ipcRenderer.send('pet:click'),
  dblclick: () => ipcRenderer.send('pet:dblclick'),
  menu: () => ipcRenderer.send('pet:menu'),
  atlas: (info) => ipcRenderer.send('pet:atlas', info),
});
