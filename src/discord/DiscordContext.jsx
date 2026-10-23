import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSync } from '../sync/SyncContext';
import { readMeta } from '../sync/snapshot';
import { getGame } from '../games';
import { getCached, loadStoredCards } from '../games/cardCache';
import { version as APP_VERSION } from '../../package.json';
import {
  GAME_ID, readLink, writeLink, clearLink, parseLinkKey, buildCards, hashCards,
  postLink, putCollection, deleteLink,
} from './link';

// Pushes this device's Riftbound collection + trade lists to the Discord bot
// whenever they change (see link.js for the protocol). Lives above the game
// UI so it keeps working while another game is open.
//
// Pushes are full replacements, skipped when the payload hashes the same as
// the last successful one. Edits debounce for 10s; transient failures retry
// at 30s / 2m / 10m, then wait for the next change. Nothing is sent before
// the startup sync has finished, so a stale pre-sync copy can't overwrite
// newer data pushed from another device.

const DiscordContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useDiscord() {
  return useContext(DiscordContext);
}

const EDIT_DELAY = 10 * 1000;
const RETRY_DELAYS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];

const client = () => ({
  app: 'riftbound-collection-manager',
  version: APP_VERSION,
  platform: (typeof window !== 'undefined' && window.__electron__?.platform) || 'web',
});

// A message for the Settings page — never includes the token.
function describe(err) {
  if (err.status === 0 || err.status === 429 || err.status >= 500) return "Couldn't reach the bot, try again.";
  if (err.code === 'too_large') return 'Your collection is too large to send.';
  if (err.code === 'bad_payload') return 'The bot rejected the data this app sent.';
  return err.message || `Bot error (${err.status}).`;
}

export function DiscordProvider({ children }) {
  const { startupDone, dataReplaced } = useSync();
  const [link, setLinkState] = useState(readLink);
  const [busy, setBusy] = useState(null);            // null | 'linking' | 'sending' | 'unlinking'
  const [notice, setNotice] = useState(null);        // shown in Settings after an unlink / link error
  const [cards, setCards] = useState(() => getCached(GAME_ID)?.cards ?? null);

  const linkRef = useRef(link);
  const cardsRef = useRef(cards);
  const timer = useRef(null);
  const retries = useRef(0);
  const sending = useRef(false);
  const pending = useRef(false);     // a push was requested mid-send
  const rejectedHash = useRef(null); // last 400/413 payload — don't resend it
  const pushRef = useRef(null);

  // Persist + publish link changes. `null` forgets the link.
  const updateLink = useCallback((patch) => {
    const next = patch === null ? null : { ...linkRef.current, ...patch };
    linkRef.current = next;
    if (next) writeLink(next); else clearLink();
    setLinkState(next);
  }, []);

  const schedule = useCallback((delay) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => pushRef.current?.(), delay);
  }, []);

  const push = useCallback(async ({ force = false } = {}) => {
    clearTimeout(timer.current);
    timer.current = null;
    const l = linkRef.current;
    const all = cardsRef.current;
    if (!l || !all?.length) return; // not linked, or cards not loaded yet
    if (sending.current) { pending.current = true; return; }

    const payloadCards = buildCards(all, getGame(GAME_ID).idRemap);
    const hash = hashCards(payloadCards);
    if (!force && (hash === l.lastPushedHash || hash === rejectedHash.current)) return;

    sending.current = true;
    setBusy('sending');
    const done = () => {
      retries.current = 0;
      rejectedHash.current = null;
      updateLink({ lastPushedHash: hash, lastPushedAt: Date.now(), lastError: null });
    };
    try {
      await putCollection(l.base, l.token, {
        format: 1,
        game: GAME_ID,
        updatedAt: l.dataChangedAt || Date.now(),
        appVersion: APP_VERSION,
        cards: payloadCards,
      });
      done();
    } catch (err) {
      if (err.status === 409) {
        done(); // stale: a newer push already landed
      } else if (err.status === 401) {
        updateLink(null);
        setNotice('Unlinked from Discord.');
      } else if (err.status === 400 || err.status === 413) {
        rejectedHash.current = hash;
        updateLink({ lastError: describe(err) });
      } else {
        updateLink({ lastError: describe(err) });
        if (retries.current < RETRY_DELAYS.length) schedule(RETRY_DELAYS[retries.current++]);
      }
    } finally {
      sending.current = false;
      setBusy(null);
      if (pending.current) { pending.current = false; schedule(0); }
    }
  }, [updateLink, schedule]);
  useEffect(() => { pushRef.current = push; }, [push]);

  // A local edit to Riftbound counts or trade lists (called by the game UI).
  const noteLocalEdit = useCallback(() => {
    if (!linkRef.current) return;
    updateLink({ dataChangedAt: Date.now() });
    retries.current = 0;
    schedule(EDIT_DELAY);
  }, [updateLink, schedule]);

  // The open Riftbound game hands over its freshly loaded card list.
  const setRiftboundCards = useCallback((list) => {
    cardsRef.current = list;
    setCards(list);
  }, []);

  // No Riftbound cards this session yet (another game is open): fall back to
  // the card list cached on disk — unless it predates the id switch.
  useEffect(() => {
    if (cardsRef.current) return;
    let alive = true;
    const idRemap = getGame(GAME_ID).idRemap;
    loadStoredCards(GAME_ID).then((stored) => {
      if (!alive || !stored || cardsRef.current) return;
      if (idRemap && stored.some((c) => idRemap.has(c.id))) return;
      cardsRef.current = stored;
      setCards(stored);
    });
    return () => { alive = false; };
  }, []);

  // Another device's snapshot was applied (or a load undone): its time is now
  // when this data last changed. The push itself is skipped if Riftbound data
  // came through unchanged.
  useEffect(() => {
    if (!dataReplaced || !linkRef.current) return;
    updateLink({ dataChangedAt: dataReplaced.at });
    retries.current = 0;
    if (startupDone) schedule(0);
  }, [dataReplaced, startupDone, updateLink, schedule]);

  // Launch / just linked: once the startup sync is done and cards are in,
  // send if anything changed since the last successful push.
  const linked = !!link?.token;
  useEffect(() => {
    if (startupDone && linked && cards?.length) schedule(0);
  }, [startupDone, linked, cards, schedule]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const linkWithKey = useCallback(async (text) => {
    const parsed = parseLinkKey(text);
    if (!parsed) {
      setNotice("That doesn't look like a link key. Copy the whole link the bot sent you.");
      return false;
    }
    setBusy('linking');
    setNotice(null);
    try {
      const res = await postLink(parsed.base, parsed.code, client());
      const meta = readMeta();
      updateLink({
        base: parsed.base,
        token: res.token,
        user: res.user,
        // When this device's data last changed, as best we know: the sync
        // file's last save/load, else now.
        dataChangedAt: Math.max(meta.lastSavedAt ?? 0, meta.lastAppliedAt ?? 0) || Date.now(),
        lastPushedHash: null,
        lastPushedAt: 0,
        lastError: null,
      });
      retries.current = 0;
      rejectedHash.current = null;
      return true; // the launch effect pushes right away
    } catch (err) {
      setNotice(err.code === 'invalid_code'
        ? 'That key has expired. Run /collection link again.'
        : err.status === 0 || err.status === 429 || err.status >= 500
          ? "Couldn't reach the bot, try again."
          : describe(err));
      return false;
    } finally {
      setBusy(null);
    }
  }, [updateLink]);

  const unlink = useCallback(async () => {
    const l = linkRef.current;
    if (!l) return;
    clearTimeout(timer.current);
    setBusy('unlinking');
    let note = null;
    try {
      await deleteLink(l.base, l.token);
    } catch (err) {
      // 401: already revoked. Anything else: forget it here anyway, but say so.
      if (err.status !== 401) note = "Unlinked on this device, but the bot couldn't be reached — run /collection unlink in Discord to be sure.";
    }
    updateLink(null);
    setNotice(note);
    setBusy(null);
  }, [updateLink]);

  const sendNow = useCallback(() => {
    retries.current = 0;
    return push({ force: true });
  }, [push]);

  const value = useMemo(() => ({
    link, busy, notice, cardsReady: !!cards?.length,
    linkWithKey, unlink, sendNow, noteLocalEdit, setRiftboundCards,
  }), [link, busy, notice, cards, linkWithKey, unlink, sendNow, noteLocalEdit, setRiftboundCards]);

  return <DiscordContext.Provider value={value}>{children}</DiscordContext.Provider>;
}
