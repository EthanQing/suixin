'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('todo', Object.freeze({
  load: () => invoke('app:load'),
  command: command => invoke('data:command', command),
  pin: enabled => invoke('window:pin', enabled),
  minimize: () => invoke('window:minimize'),
  hide: () => invoke('window:hide'),
  quit: () => invoke('app:quit'),
  openDataDirectory: () => invoke('app:open-data-directory'),
  exportBackup: () => invoke('backup:export'),
  chooseBackup: () => invoke('backup:choose'),
  applyBackup: token => invoke('backup:apply', token),
  cancelBackup: () => invoke('backup:cancel'),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('app:state', listener);
    return () => ipcRenderer.removeListener('app:state', listener);
  },
  onError: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('app:error', listener);
    return () => ipcRenderer.removeListener('app:error', listener);
  }
}));
