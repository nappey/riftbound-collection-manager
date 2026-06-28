import { useEffect, useRef, useState } from 'react';

// Header button to manually check for updates. Gives transient feedback for the
// quiet states the toast ignores (checking / up-to-date / error); the download
// and "ready to restart" states are handled by <UpdateToast/>. Only rendered in
// the Electron app, where the updater bridge exists.
export default function CheckForUpdatesButton() {
  const api = typeof window !== 'undefined' ? window.__electron__?.updates : null;
  const [label, setLabel] = useState(null); // transient status label
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const flash = (text, ms = 3000) => {
    setLabel(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel(null), ms);
  };

  useEffect(() => {
    if (!api) return;
    const off = api.onStatus((p) => {
      switch (p?.state) {
        case 'checking': setBusy(true); setLabel('Checking…'); break;
        case 'none': setBusy(false); flash('Up to date'); break;
        case 'downloading': setBusy(false); flash('Update found — downloading'); break;
        case 'ready': setBusy(false); setLabel(null); break;
        case 'error': setBusy(false); flash('Update check failed'); break;
        default: break;
      }
    });
    return () => { off?.(); clearTimeout(timer.current); };
  }, [api]);

  if (!api) return null; // browser dev build — no updater

  const onClick = async () => {
    setBusy(true);
    setLabel('Checking…');
    const ok = await api.check();
    if (!ok) { setBusy(false); flash('Not available'); }
  };

  return (
    <button className="btn ghost" onClick={onClick} disabled={busy} title="Check for updates">
      {busy ? '⟳ ' : ''}{label ?? 'Check for updates'}
    </button>
  );
}
