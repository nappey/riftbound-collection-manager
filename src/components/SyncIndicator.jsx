import { useEffect, useState } from 'react';
import { useSync } from '../sync/SyncContext';
import { timeAgo } from '../sync/timeAgo';

// Header pill showing device-sync state at a glance; clicking opens Settings.
// Hidden in the browser build, where sync isn't available.
export default function SyncIndicator({ onClick }) {
  const sync = useSync();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  if (!sync?.available) return null;
  const { config, status, error, lastSyncAt, pendingChoice } = sync;

  let state, label, title;
  if (!config?.path) {
    state = 'off'; label = 'Sync off'; title = 'Sync between devices is off — click to set it up';
  } else if (pendingChoice) {
    state = 'error'; label = 'Sync: choose data'; title = 'Choose whether to use the sync file or this computer\'s data';
  } else if (status === 'error') {
    state = 'error'; label = 'Sync error'; title = error ?? 'Sync problem — click for details';
  } else if (status === 'saving') {
    state = 'saving'; label = 'Syncing…'; title = `Saving to ${config.path}`;
  } else {
    state = 'saved';
    label = status === 'loaded' ? `Updated · ${timeAgo(lastSyncAt, now)}` : `Synced · ${timeAgo(lastSyncAt, now)}`;
    title = status === 'loaded'
      ? `Loaded changes from another device · ${config.path}`
      : `Synced to ${config.path}`;
  }

  return (
    <button className={`sync-pill sync-pill--${state}`} onClick={onClick} title={title}>
      <span className="sync-dot" />
      {label}
    </button>
  );
}
