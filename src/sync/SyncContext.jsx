import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSnapshot, applySnapshot, parseSnapshot, getDeviceId, readMeta, writeMeta,
  saveBackup, hasBackup, restoreBackup, getDisplayName, setDisplayName as storeDisplayName, parseFriend,
} from './snapshot';

// Device sync: every game's data is mirrored to one JSON file the user picks
// (normally in a Google Drive / iCloud / Dropbox folder). Edits are saved to
// it after a short debounce; when another device's newer save shows up, it
// replaces local data (after backing it up) and `dataVersion` bumps so the
// app remounts and re-reads localStorage. Last change wins.
//
// Friends: other people's sync files in the same (shared) folder are read
// read-only and exposed as `friends`, refreshed on focus and every minute.

const SyncContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useSync() {
  return useContext(SyncContext);
}

const SAVE_DELAY = 1500;
const FRIENDS_REFRESH = 60 * 1000;

export function SyncProvider({ children }) {
  const api = typeof window !== 'undefined' ? window.__electron__?.sync ?? null : null;
  const [deviceId] = useState(getDeviceId);
  const [config, setConfigState] = useState(null);           // { path, csvCopy }
  const [status, setStatus] = useState('idle');              // idle | saving | saved | loaded | error
  const [error, setError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => {
    const m = readMeta();
    return Math.max(m.lastSavedAt ?? 0, m.lastAppliedAt ?? 0) || null;
  });
  const [dataVersion, setDataVersion] = useState(0);
  const [backupAvailable, setBackupAvailable] = useState(hasBackup);
  // Set when the user picks an existing sync file: load it, or replace it?
  const [pendingChoice, setPendingChoice] = useState(null);
  const [displayName, setDisplayNameState] = useState(getDisplayName);
  const [friends, setFriends] = useState([]);

  const configRef = useRef(null);
  const timer = useRef(null);
  const dirtyAt = useRef(0);       // time of the oldest unsaved local edit
  const busy = useRef(false);
  const csvWriter = useRef(null);  // set by the open game: writes its CSV copy

  const setConfig = useCallback((cfg) => {
    configRef.current = cfg;
    setConfigState(cfg);
  }, []);

  const fail = useCallback((err) => {
    setStatus('error');
    // Drop Electron's "Error invoking remote method 'sync:read': Error:" prefix.
    setError(String(err?.message ?? err).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, ''));
  }, []);

  const save = useCallback(async () => {
    clearTimeout(timer.current);
    timer.current = null;
    if (!api || !configRef.current?.path) return;
    setStatus('saving');
    try {
      const snap = buildSnapshot(deviceId);
      await api.write(JSON.stringify(snap, null, 1));
      writeMeta({ lastSavedAt: snap.savedAt });
      dirtyAt.current = 0;
      if (configRef.current.csvCopy) await csvWriter.current?.();
      setStatus('saved');
      setLastSyncAt(snap.savedAt);
      setError(null);
    } catch (err) {
      fail(err);
    }
  }, [api, deviceId, fail]);

  const scheduleSave = useCallback(() => {
    if (!api || !configRef.current?.path) return;
    if (!dirtyAt.current) dirtyAt.current = Date.now();
    clearTimeout(timer.current);
    timer.current = setTimeout(save, SAVE_DELAY);
  }, [api, save]);

  const load = useCallback((snap) => {
    clearTimeout(timer.current);
    timer.current = null;
    dirtyAt.current = 0;
    saveBackup(deviceId);
    applySnapshot(snap);
    setDisplayNameState(getDisplayName()); // the file carries our name too
    writeMeta({ lastAppliedAt: snap.savedAt });
    setBackupAvailable(true);
    setDataVersion((v) => v + 1);
    setStatus('loaded');
    setLastSyncAt(snap.savedAt);
    setError(null);
  }, [deviceId]);

  // Compare the file with local data and move whichever is newer.
  const reconcile = useCallback(async () => {
    if (!api || !configRef.current?.path || busy.current) return;
    busy.current = true;
    try {
      const file = await api.read();
      const snap = file ? parseSnapshot(file.text) : null;
      if (file && !snap) throw new Error("The sync file isn't a Card Manager sync file.");
      const meta = readMeta();
      const seen = Math.max(meta.lastAppliedAt ?? 0, meta.lastSavedAt ?? 0);
      const theirsIsNewer = snap && snap.deviceId !== deviceId && snap.savedAt > seen
        && !(dirtyAt.current && dirtyAt.current > snap.savedAt);
      if (theirsIsNewer) {
        load(snap);
      } else if (!snap || dirtyAt.current || snap.savedAt < (meta.lastSavedAt ?? 0)) {
        await save();
      } else {
        setStatus((s) => (s === 'error' ? 'idle' : s));
        setError(null);
      }
    } catch (err) {
      fail(err);
    } finally {
      busy.current = false;
    }
  }, [api, deviceId, load, save, fail]);

  const refreshFriends = useCallback(async () => {
    if (!api?.readFriends || !configRef.current?.path) { setFriends([]); return; }
    try {
      const files = await api.readFriends();
      const list = files.map(parseFriend)
        .filter((f) => f && f.deviceId !== deviceId) // skip stray copies of our own file
        .sort((a, b) => a.name.localeCompare(b.name));
      setFriends(list);
    } catch {
      /* folder unreachable — keep the last list */
    }
  }, [api, deviceId]);

  // Startup: load the config, then sync once.
  useEffect(() => {
    if (!api) return;
    let alive = true;
    api.getConfig().then((cfg) => {
      if (!alive) return;
      setConfig(cfg);
      if (cfg?.path) { reconcile(); refreshFriends(); }
    }).catch(fail);
    return () => { alive = false; };
  }, [api, setConfig, reconcile, refreshFriends, fail]);

  // Another device (or the cloud client) changed the file, or the user came
  // back to the window: check for newer data.
  useEffect(() => {
    if (!api) return;
    const off = api.onFileChanged(() => reconcile());
    const onFocus = () => { reconcile(); refreshFriends(); };
    window.addEventListener('focus', onFocus);
    const poll = setInterval(refreshFriends, FRIENDS_REFRESH);
    return () => { off(); window.removeEventListener('focus', onFocus); clearInterval(poll); };
  }, [api, reconcile, refreshFriends]);

  // Flush an unsaved edit when the app quits.
  useEffect(() => {
    if (!api) return;
    const flush = () => {
      if (!timer.current || !configRef.current?.path) return;
      clearTimeout(timer.current);
      const snap = buildSnapshot(deviceId);
      if (api.writeNow(JSON.stringify(snap, null, 1)) != null) writeMeta({ lastSavedAt: snap.savedAt });
    };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, [api, deviceId]);

  const chooseFile = useCallback(async (mode) => {
    if (!api) return;
    try {
      const cfg = await api.choose(mode, getDisplayName());
      if (!cfg) return; // cancelled
      setConfig({ path: cfg.path, csvCopy: cfg.csvCopy });
      setPendingChoice(null);
      if (mode === 'existing' && cfg.exists) {
        const file = await api.read();
        const snap = file ? parseSnapshot(file.text) : null;
        if (!snap) {
          await api.disable();
          setConfig({ path: null, csvCopy: cfg.csvCopy });
          throw new Error("That file isn't a Card Manager sync file.");
        }
        setPendingChoice(snap);
        refreshFriends();
        return;
      }
      await save();
      refreshFriends();
    } catch (err) {
      fail(err);
    }
  }, [api, setConfig, save, refreshFriends, fail]);

  const resolveChoice = useCallback(async (useFile) => {
    const snap = pendingChoice;
    setPendingChoice(null);
    if (!snap) return;
    if (useFile) load(snap);
    else await save();
  }, [pendingChoice, load, save]);

  const disable = useCallback(async () => {
    if (!api) return;
    clearTimeout(timer.current);
    timer.current = null;
    setPendingChoice(null);
    setConfig(await api.disable());
    setFriends([]);
    setStatus('idle');
    setError(null);
  }, [api, setConfig]);

  const setCsvCopy = useCallback(async (on) => {
    if (!api) return;
    setConfig(await api.setCsvCopy(on));
    if (on) await save();
  }, [api, setConfig, save]);

  const undoLastLoad = useCallback(async () => {
    if (!restoreBackup()) return;
    setDisplayNameState(getDisplayName());
    setBackupAvailable(false);
    setDataVersion((v) => v + 1);
    dirtyAt.current = Date.now();
    await save(); // the restored data becomes the newest version everywhere
  }, [save]);

  const setCsvWriter = useCallback((fn) => { csvWriter.current = fn; }, []);

  const setDisplayName = useCallback((name) => {
    storeDisplayName(name);
    setDisplayNameState(name);
    scheduleSave();
  }, [scheduleSave]);

  const value = useMemo(() => ({
    available: !!api,
    config, status, error, lastSyncAt, dataVersion, backupAvailable, pendingChoice, displayName, friends,
    scheduleSave, syncNow: reconcile, chooseFile, resolveChoice, disable, setCsvCopy, undoLastLoad, setCsvWriter,
    setDisplayName, refreshFriends,
  }), [api, config, status, error, lastSyncAt, dataVersion, backupAvailable, pendingChoice, displayName, friends,
    scheduleSave, reconcile, chooseFile, resolveChoice, disable, setCsvCopy, undoLastLoad, setCsvWriter,
    setDisplayName, refreshFriends]);

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
