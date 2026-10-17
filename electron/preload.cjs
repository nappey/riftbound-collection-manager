'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electron__', {
  isElectron: true,
  platform: process.platform,
  // Fetch an image in the main process (no CORS) and return a data URL so it
  // can be drawn onto a canvas without tainting it (for the deck image export).
  fetchImageDataUrl: (url) => ipcRenderer.invoke('fetch-image', url),

  appVersion: () => ipcRenderer.invoke('app:version'),

  // Sync-file bridge. The main process owns the file path; these only ever
  // touch the file the user picked in Settings.
  sync: {
    getConfig: () => ipcRenderer.invoke('sync:get-config'),
    choose: (mode, ownerName) => ipcRenderer.invoke('sync:choose', mode, ownerName),
    readFriends: () => ipcRenderer.invoke('sync:read-friends'),
    disable: () => ipcRenderer.invoke('sync:disable'),
    setCsvCopy: (on) => ipcRenderer.invoke('sync:set-csv-copy', on),
    read: () => ipcRenderer.invoke('sync:read'),
    write: (text) => ipcRenderer.invoke('sync:write', text),
    writeNow: (text) => ipcRenderer.sendSync('sync:write-now', text),
    writeCsv: (gameId, text) => ipcRenderer.invoke('sync:write-csv', gameId, text),
    onFileChanged: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('sync:file-changed', listener);
      return () => ipcRenderer.removeListener('sync:file-changed', listener);
    },
  },

  // Auto-update bridge.
  updates: {
    // Subscribe to update status pushes. Returns an unsubscribe function.
    onStatus: (cb) => {
      const listener = (_e, payload) => cb(payload);
      ipcRenderer.on('update:status', listener);
      return () => ipcRenderer.removeListener('update:status', listener);
    },
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    openDownload: () => ipcRenderer.invoke('update:open-download'),
  },
});
