'use strict';

const { app, BrowserWindow, session } = require('electron');
const path = require('path');

const isDev = process.env.ELECTRON_IS_DEV === '1';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#07070e',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.includes('tcgcsv.com')) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Access-Control-Allow-Origin': ['*'],
          'Access-Control-Allow-Headers': ['*'],
        },
      });
    } else {
      callback({ responseHeaders: details.responseHeaders });
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
    win.setMenuBarVisibility(false);
  }
}

// Check GitHub Releases for a newer version and download/notify in the
// background. Only runs in the packaged app (electron-updater needs the
// built app-update.yml and a real version to compare against).
function initAutoUpdate() {
  if (isDev) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return; // dependency not installed — skip silently
  }
  autoUpdater.autoDownload = true;
  autoUpdater.on('error', (err) => console.error('[updater]', err?.message ?? err));
  autoUpdater.checkForUpdatesAndNotify().catch((err) =>
    console.error('[updater] check failed:', err?.message ?? err)
  );
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
