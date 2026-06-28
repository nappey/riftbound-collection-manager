'use strict';

const { app, BrowserWindow, session, ipcMain, net } = require('electron');
const path = require('path');

const isDev = process.env.ELECTRON_IS_DEV === '1';

// Fetch an image in the main process (no CORS) and return a data URL. The deck
// image export draws these onto a canvas; data URLs never taint it.
ipcMain.handle('fetch-image', async (_e, url) => {
  try {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
    const res = await net.fetch(url);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || 'image/png';
    const buf = Buffer.from(await res.arrayBuffer());
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
});

let mainWindow = null;

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

  // Inject permissive CORS so prices (tcgcsv) load, and so card-image CDNs can
  // be drawn onto a canvas CORS-clean for the deck image export.
  const CORS_HOSTS = ['tcgcsv.com', 'cmsassets.rgpub.io', 'tcgplayer-cdn.tcgplayer.com'];
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (CORS_HOSTS.some(h => details.url.includes(h))) {
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

  mainWindow = win;
  win.on('closed', () => { if (mainWindow === win) mainWindow = null; });
}

// Check GitHub Releases for a newer version, download it in the background, and
// stream status to the renderer so it can show an in-app update toast. Only the
// packaged app actually updates (electron-updater needs the built app-update.yml
// and a real version to compare against), but the IPC handlers are always
// registered so the renderer can call them without rejecting.
function initAutoUpdate() {
  let autoUpdater = null;
  if (!isDev) {
    try {
      ({ autoUpdater } = require('electron-updater'));
    } catch {
      autoUpdater = null; // dependency missing — degrade gracefully
    }
  }

  const sendStatus = (payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:status', payload);
    }
  };

  // Manual "check for updates" from the renderer. Returns false when updates
  // aren't available in this context (dev / unpackaged).
  ipcMain.handle('update:check', async () => {
    if (!autoUpdater) return false;
    try { await autoUpdater.checkForUpdates(); return true; }
    catch (err) { sendStatus({ state: 'error', message: String(err?.message ?? err) }); return false; }
  });
  // Quit and install a downloaded update right now.
  ipcMain.handle('update:install', () => { if (autoUpdater) autoUpdater.quitAndInstall(); });

  if (!autoUpdater) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // install on quit if not restarted sooner

  autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendStatus({ state: 'downloading', version: info?.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendStatus({ state: 'downloading', percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on('update-downloaded', (info) => sendStatus({ state: 'ready', version: info?.version }));
  autoUpdater.on('error', (err) => sendStatus({ state: 'error', message: String(err?.message ?? err) }));

  autoUpdater.checkForUpdates().catch((err) =>
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
