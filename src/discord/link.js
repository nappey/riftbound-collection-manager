// Discord bot link: a one-way push of this device's Riftbound collection and
// trade lists to the team bot (riftbound-team-tracker), so people in Discord
// can ask who has a card. Local-first data is untouched — this only reads it.
//
// The user runs /collection link in Discord and pastes the link key it gives
// them ("https://<bot>/#K7QM-2XPA"); POST /link swaps the one-time code for a
// bearer token, and PUT /collection then replaces the user's data on every
// change. The token belongs to this device only: it lives under its own
// localStorage key and never goes into the sync file (friends can read that).

import { DISCORD_LINK_KEY, storageKeys } from '../games/storage';
import { remapKeys } from '../utils/remapIds';

export const GAME_ID = 'riftbound';

// ── Stored link ────────────────────────────────────────────────

/** { base, token, user: { id, name }, dataChangedAt, lastPushedHash, lastPushedAt, lastError } | null */
export function readLink() {
  try {
    const link = JSON.parse(localStorage.getItem(DISCORD_LINK_KEY));
    return link?.base && link?.token ? link : null;
  } catch {
    return null;
  }
}

export function writeLink(link) {
  try { localStorage.setItem(DISCORD_LINK_KEY, JSON.stringify(link)); } catch { /* storage full */ }
}

export function clearLink() {
  try { localStorage.removeItem(DISCORD_LINK_KEY); } catch { /* ignore */ }
}

// ── Link key ───────────────────────────────────────────────────

/**
 * "https://abc.lambda-url.us-east-1.on.aws/#K7QM-2XPA" → { base, code }, or
 * null when it isn't https or has no code. Plain http is allowed only for
 * localhost, so a local mock bot can be used while developing.
 */
export function parseLinkKey(text) {
  let url;
  try { url = new URL(String(text ?? '').trim()); } catch { return null; }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  const code = url.hash.replace(/^#/, '').trim();
  if (!code) return null;
  return { base: url.origin, code };
}

// ── Payload ────────────────────────────────────────────────────

function readSaved(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
}

/**
 * The PUT /collection `cards` map, keyed by riftbound_id: { n, f, trade, want }
 * with zero/false fields left out. Read straight from localStorage so it works
 * whichever game is open, and re-keyed through the game's legacy id map in case
 * Riftbound hasn't been opened since the id switch. Raw stored counts — the bot
 * applies playset/foil rules itself.
 */
export function buildCards(allCards, idRemap) {
  const K = storageKeys(GAME_ID);
  const re = (v) => (idRemap ? remapKeys(v, idRemap) : v);
  const collection = re(readSaved(K.collection));
  const foil = re(readSaved(K.foil));
  const want = re(readSaved(K.lf));
  const trade = re(readSaved(K.uft));

  const byId = new Map(allCards.map((c) => [c.id, c]));
  const ids = new Set([...Object.keys(collection), ...Object.keys(foil), ...Object.keys(want), ...Object.keys(trade)]);
  const cards = {};
  for (const id of [...ids].sort()) {
    const rid = byId.get(id)?.riftbound_id;
    if (!rid) continue; // not a known card, or no riftbound_id
    const n = collection[id] ?? 0, f = foil[id] ?? 0;
    if (!(n > 0 || f > 0 || want[id] || trade[id])) continue;
    // A few promo printings share one riftbound_id (OPP's Metal promos); the
    // bot only sees the id, so their counts add up and the flags combine.
    const e = cards[rid] ?? (cards[rid] = {});
    if (n > 0) e.n = (e.n ?? 0) + n;
    if (f > 0) e.f = (e.f ?? 0) + f;
    if (trade[id]) e.trade = true;
    if (want[id]) e.want = true;
  }
  return cards;
}

// FNV-1a over the cards JSON — enough to tell "same payload as last time".
export function hashCards(cards) {
  const s = JSON.stringify(cards);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0') + ':' + s.length;
}

// ── API ────────────────────────────────────────────────────────

/** Thrown for any non-2xx (or network failure: status 0). Never carries the token. */
export class BotError extends Error {
  constructor(status, code, message) {
    super(message || code || `HTTP ${status}`);
    this.status = status;
    this.code = code;
  }
}

async function call(base, path, { method, token, body }) {
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new BotError(0, 'network', "Couldn't reach the bot");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new BotError(res.status, data?.error, data?.message);
  return data;
}

export const postLink = (base, code, client) =>
  call(base, '/link', { method: 'POST', body: { code, client } });

export const putCollection = (base, token, body) =>
  call(base, '/collection', { method: 'PUT', token, body });

export const deleteLink = (base, token) =>
  call(base, '/link', { method: 'DELETE', token });
