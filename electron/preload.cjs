'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__electron__', {
  isElectron: true,
  // Fetch an image in the main process (no CORS) and return a data URL so it
  // can be drawn onto a canvas without tainting it (for the deck image export).
  fetchImageDataUrl: (url) => ipcRenderer.invoke('fetch-image', url),
});
