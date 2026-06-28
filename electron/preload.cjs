'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electron__', {
  isElectron: true,
  // Fetch an image in the main process (no CORS) and return a data URL so it
  // can be drawn onto a canvas without tainting it (for the deck image export).
  fetchImageDataUrl: (url) => ipcRenderer.invoke('fetch-image', url),

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
  },
});
