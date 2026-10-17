import { GAME_IDS } from '../games';
import { storageKeys, DEVICE_ID_KEY, SYNC_META_KEY, SYNC_BACKUP_KEY, DISPLAY_NAME_KEY } from '../games/storage';

// A snapshot is every game's saved data (the localStorage keys from
// storageKeys) in one JSON document — the contents of the sync file. It reads
// localStorage directly so games that aren't open still sync.

const APP = 'card-manager';
const FORMAT = 1;
// Stored as a plain string in localStorage; every other field is JSON.
const RAW_FIELDS = new Set(['vendor']);

export function buildSnapshot(deviceId, savedAt = Date.now()) {
  const games = {};
  for (const gameId of GAME_IDS) {
    const data = {};
    for (const [field, key] of Object.entries(storageKeys(gameId))) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      if (RAW_FIELDS.has(field)) { data[field] = raw; continue; }
      try { data[field] = JSON.parse(raw); } catch { /* skip corrupt value */ }
    }
    games[gameId] = data;
  }
  return { app: APP, format: FORMAT, savedAt, deviceId, owner: { name: getDisplayName() }, games };
}

export function applySnapshot(snap) {
  if (snap.owner?.name) localStorage.setItem(DISPLAY_NAME_KEY, snap.owner.name);
  for (const gameId of GAME_IDS) {
    const data = snap.games?.[gameId];
    if (!data) continue;
    for (const [field, key] of Object.entries(storageKeys(gameId))) {
      if (!(field in data)) continue;
      localStorage.setItem(key, RAW_FIELDS.has(field) ? String(data[field] ?? '') : JSON.stringify(data[field]));
    }
  }
}

// Returns the snapshot, or null if the text isn't a sync file we understand.
export function parseSnapshot(text) {
  try {
    const snap = JSON.parse(text);
    if (snap?.app !== APP || typeof snap.format !== 'number' || snap.format > FORMAT) return null;
    if (typeof snap.games !== 'object' || !snap.games) return null;
    return snap;
  } catch {
    return null;
  }
}

export function getDisplayName() {
  return localStorage.getItem(DISPLAY_NAME_KEY) ?? '';
}

export function setDisplayName(name) {
  localStorage.setItem(DISPLAY_NAME_KEY, name);
}

// A friend's sync file → { id, name, savedAt, games }, or null if it isn't one.
// Unnamed files fall back to the file name ("card-manager-alex.json" → "alex").
export function parseFriend({ file, text }) {
  const snap = parseSnapshot(text);
  if (!snap) return null;
  const fromFile = file.replace(/\.json$/i, '').replace(/^card-manager-?/i, '') || file;
  return { id: file, name: snap.owner?.name?.trim() || fromFile, savedAt: snap.savedAt, deviceId: snap.deviceId, games: snap.games };
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function readMeta() {
  try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) ?? {}; }
  catch { return {}; }
}

export function writeMeta(patch) {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...readMeta(), ...patch }));
}

// Keep this device's data from just before a sync load, so it can be undone.
export function saveBackup(deviceId) {
  try { localStorage.setItem(SYNC_BACKUP_KEY, JSON.stringify(buildSnapshot(deviceId))); }
  catch { /* storage full — skip the backup rather than block the sync */ }
}

export function hasBackup() {
  return !!localStorage.getItem(SYNC_BACKUP_KEY);
}

export function restoreBackup() {
  const snap = parseSnapshot(localStorage.getItem(SYNC_BACKUP_KEY) ?? '');
  if (!snap) return false;
  applySnapshot(snap);
  localStorage.removeItem(SYNC_BACKUP_KEY);
  return true;
}
