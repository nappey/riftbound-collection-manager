import { useEffect, useState } from 'react';

// Listens to the Electron auto-updater and surfaces a small toast: download
// progress while fetching, then a "Restart to update" prompt when ready.
// Renders nothing in the browser dev build (no Electron bridge).
export default function UpdateToast() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const api = window.__electron__?.updates;
    if (!api) return;
    return api.onStatus((payload) => {
      setStatus(payload);
      if (payload?.state === 'downloading' || payload?.state === 'ready') setDismissed(false);
    });
  }, []);

  const state = status?.state;
  if (!state || dismissed) return null;
  // Quiet states — no toast for "checking", "none", or "error".
  if (state !== 'downloading' && state !== 'ready') return null;

  const ready = state === 'ready';
  const ver = status.version ? `v${status.version}` : 'A new version';

  return (
    <div className={`update-toast${ready ? ' ready' : ''}`} role="status">
      <div className="update-toast-icon">{ready ? '✓' : '⬇'}</div>
      <div className="update-toast-body">
        {ready ? (
          <>
            <div className="update-toast-title">{ver} is ready</div>
            <div className="update-toast-sub">Restart to finish updating.</div>
          </>
        ) : (
          <>
            <div className="update-toast-title">Downloading update…</div>
            <div className="update-toast-bar">
              <div className="update-toast-fill" style={{ width: `${status.percent ?? 0}%` }} />
            </div>
          </>
        )}
      </div>
      <div className="update-toast-actions">
        {ready && (
          <button className="btn primary" onClick={() => window.__electron__?.updates?.install()}>
            Restart
          </button>
        )}
        <button className="btn ghost update-toast-x" onClick={() => setDismissed(true)} aria-label="Dismiss">✕</button>
      </div>
    </div>
  );
}
