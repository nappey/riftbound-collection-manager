'use strict';

const { app, BrowserWindow, session, ipcMain, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const isDev = process.env.ELECTRON_IS_DEV === '1';
const isMac = process.platform === 'darwin';
const RELEASES_URL = 'https://github.com/nappey/riftbound-collection-manager/releases/latest';

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

ipcMain.handle('app:version', () => app.getVersion());

// ── Sync file ──────────────────────────────────────────────────
// The renderer saves every game's data to one JSON file the user picks —
// normally inside a cloud-synced folder (Google Drive, iCloud, Dropbox) so it
// travels between devices. The main process owns the path: the renderer can
// only read/write *the chosen file*, never an arbitrary one.
const SYNC_GAME_IDS = new Set(['riftbound', 'cyberpunk']);
const syncSettingsFile = () => path.join(app.getPath('userData'), 'sync-settings.json');
let syncConfig = { path: null, csvCopy: false };
let watchedPath = null;

function loadSyncConfig() {
  try { syncConfig = { ...syncConfig, ...JSON.parse(fs.readFileSync(syncSettingsFile(), 'utf8')) }; }
  catch { /* no settings yet */ }
}
function saveSyncConfig() {
  try { fs.writeFileSync(syncSettingsFile(), JSON.stringify(syncConfig, null, 2)); }
  catch (err) { console.error('[sync] could not save settings:', err?.message ?? err); }
}

// Write via a temp file + rename so another device never reads half a file.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
  return fs.statSync(file).mtimeMs;
}

// Poll rather than fs.watch: cloud clients replace files in ways native
// watchers miss, and a 5s poll on one small file is cheap.
function watchSyncFile() {
  if (watchedPath) fs.unwatchFile(watchedPath);
  watchedPath = syncConfig.path;
  if (!watchedPath) return;
  fs.watchFile(watchedPath, { interval: 5000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:file-changed', { mtimeMs: cur.mtimeMs });
    }
  });
}

const publicConfig = () => ({ path: syncConfig.path, csvCopy: !!syncConfig.csvCopy });

ipcMain.handle('sync:get-config', () => publicConfig());

// mode 'new' → save dialog (first device); 'existing' → open dialog (picking
// the file another device already syncs to).
ipcMain.handle('sync:choose', async (_e, mode, ownerName) => {
  // Name new files after their owner so friends sharing a folder don't collide.
  const slug = String(ownerName ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const defaultPath = syncConfig.path ?? path.join(app.getPath('documents'), `card-manager-${slug || 'sync'}.json`);
  const filters = [{ name: 'Card Manager sync', extensions: ['json'] }];
  let file = null;
  if (mode === 'existing') {
    const res = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: 'Choose your existing sync file', defaultPath, filters, properties: ['openFile'],
    });
    if (!res.canceled) file = res.filePaths[0] ?? null;
  } else {
    const res = await dialog.showSaveDialog(mainWindow ?? undefined, {
      title: 'Create sync file', buttonLabel: 'Create', defaultPath, filters, properties: ['createDirectory'],
    });
    if (!res.canceled) file = res.filePath ?? null;
  }
  if (!file) return null;
  syncConfig.path = file;
  saveSyncConfig();
  watchSyncFile();
  return { ...publicConfig(), exists: fs.existsSync(file) };
});

ipcMain.handle('sync:disable', () => {
  syncConfig.path = null;
  saveSyncConfig();
  watchSyncFile();
  return publicConfig();
});

ipcMain.handle('sync:set-csv-copy', (_e, on) => {
  syncConfig.csvCopy = !!on;
  saveSyncConfig();
  return publicConfig();
});

ipcMain.handle('sync:read', () => {
  if (!syncConfig.path) return null;
  try {
    return { text: fs.readFileSync(syncConfig.path, 'utf8'), mtimeMs: fs.statSync(syncConfig.path).mtimeMs };
  } catch (err) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('sync:write', (_e, text) => {
  if (!syncConfig.path || typeof text !== 'string') return null;
  return writeAtomic(syncConfig.path, text);
});

// Synchronous variant so the renderer can flush unsaved edits on quit.
ipcMain.on('sync:write-now', (e, text) => {
  try {
    e.returnValue = syncConfig.path && typeof text === 'string' ? writeAtomic(syncConfig.path, text) : null;
  } catch {
    e.returnValue = null;
  }
});

// Friends: every other sync file in the same folder, read-only. The renderer
// keeps only the ones that parse as Card Manager files.
const MAX_FRIEND_FILE = 20 * 1024 * 1024;
ipcMain.handle('sync:read-friends', () => {
  if (!syncConfig.path) return [];
  const dir = path.dirname(syncConfig.path);
  const own = path.basename(syncConfig.path);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (name === own || !name.toLowerCase().endsWith('.json') || name.startsWith('.')) continue;
    const file = path.join(dir, name);
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > MAX_FRIEND_FILE) continue;
      out.push({ file: name, mtimeMs: st.mtimeMs, text: fs.readFileSync(file, 'utf8') });
    } catch { /* unreadable / still syncing — skip */ }
  }
  return out;
});

ipcMain.handle('sync:write-csv', (_e, gameId, text) => {
  if (!syncConfig.path || !syncConfig.csvCopy || !SYNC_GAME_IDS.has(gameId) || typeof text !== 'string') return null;
  return writeAtomic(path.join(path.dirname(syncConfig.path), `${gameId}-collection.csv`), text);
});

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
  const CORS_HOSTS = ['tcgcsv.com', 'cmsassets.rgpub.io', 'tcgplayer-cdn.tcgplayer.com', 'api.netdeck.gg', 'dstcynss47vun.cloudfront.net'];
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
  // macOS: open the latest release so the user can grab the new .dmg.
  ipcMain.handle('update:open-download', () => shell.openExternal(RELEASES_URL));

  if (!autoUpdater) return;

  // The Mac build is ad-hoc signed (no Apple Developer ID), and Squirrel.Mac
  // refuses to install updates that aren't signed with a real identity. So on
  // macOS we only check — the renderer shows a "Download" link instead.
  autoUpdater.autoDownload = !isMac;
  autoUpdater.autoInstallOnAppQuit = !isMac; // install on quit if not restarted sooner

  // ── Update security hardening ──────────────────────────────────
  // electron-updater downloads `latest.yml` over HTTPS from the GitHub repo and
  // verifies the installer's SHA-512 against that manifest BEFORE it will run
  // the installer. A corrupted or tampered download fails that check and is
  // discarded rather than executed — that integrity check is the primary
  // defense and is on by default. We reinforce it:
  //   • Pin the feed to the exact official repo over HTTPS, so the update source
  //     can't be silently redirected elsewhere. (Must match build.publish.)
  //   • Refuse downgrades and prereleases, so an older/vulnerable or unfinished
  //     build can't be served as an "update".
  try {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'nappey',
      repo: 'riftbound-collection-manager',
      protocol: 'https',
    });
  } catch (err) {
    console.error('[updater] could not pin feed URL:', err?.message ?? err);
  }
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => sendStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendStatus(
    isMac
      ? { state: 'available', version: info?.version }
      : { state: 'downloading', version: info?.version, percent: 0 }
  ));
  autoUpdater.on('update-not-available', () => sendStatus({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => sendStatus({ state: 'downloading', percent: Math.round(p?.percent ?? 0) }));
  autoUpdater.on('update-downloaded', (info) => sendStatus({ state: 'ready', version: info?.version }));
  autoUpdater.on('error', (err) => sendStatus({ state: 'error', message: String(err?.message ?? err) }));

  autoUpdater.checkForUpdates().catch((err) =>
    console.error('[updater] check failed:', err?.message ?? err)
  );
}

app.whenReady().then(() => {
  loadSyncConfig();
  watchSyncFile();
  createWindow();
  initAutoUpdate();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
