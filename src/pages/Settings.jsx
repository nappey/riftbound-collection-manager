import { useEffect, useState } from 'react';
import { useSync } from '../sync/SyncContext';
import CheckForUpdatesButton from '../components/CheckForUpdatesButton';
import ExportButton from '../components/ExportButton';
import ImportButton from '../components/ImportButton';
import { timeAgo } from '../sync/timeAgo';
import { THEMES, switchTheme, loadThemeId } from '../themes';
import { ThemeSigil, ThemeShapes } from '../components/ThemeBackdrop';


const STATUS_LABEL = {
  idle: 'Synced',
  saving: 'Saving…',
  saved: 'Saved',
  loaded: 'Loaded changes from another device',
  error: 'Sync problem',
};

function SyncSection() {
  const sync = useSync();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);

  if (!sync.available) {
    return <p className="settings-note">Syncing between devices is available in the desktop app.</p>;
  }

  const { config, status, error, lastSyncAt, backupAvailable, pendingChoice, displayName, friends } = sync;
  const on = !!config?.path;

  return (
    <>
      <p className="settings-note">
        Keep your collection, decks, trade lists and Merchant the same on every computer. Pick a file inside a
        folder that syncs: <b>Google Drive</b> (desktop app), <b>iCloud Drive</b>, <b>Dropbox</b> or <b>OneDrive</b>.
        The app saves to it automatically and picks up changes made on your other devices.
      </p>

      <div className="settings-row">
        <span className="settings-label">Your name</span>
        <input
          className="settings-input"
          value={displayName}
          maxLength={40}
          placeholder="Shown to friends, e.g. Alex"
          onChange={(e) => sync.setDisplayName(e.target.value)}
        />
      </div>

      {pendingChoice && (
        <div className="settings-callout">
          <div>
            This sync file already has data, last saved {timeAgo(pendingChoice.savedAt, now)}.
            Which should this computer use?
          </div>
          <div className="settings-actions">
            <button className="btn primary" onClick={() => sync.resolveChoice(true)}>Use data from file</button>
            <button className="btn danger" onClick={() => sync.resolveChoice(false)}>Replace file with this computer's data</button>
          </div>
        </div>
      )}

      {on ? (
        <>
          <div className="settings-row">
            <span className="settings-label">File</span>
            <code className="settings-path" title={config.path}><bdi>{config.path}</bdi></code>
          </div>
          <div className="settings-row">
            <span className="settings-label">Status</span>
            <span className={`sync-status sync-status--${status}`}>
              <span className="sync-dot" />
              {STATUS_LABEL[status] ?? status}
              {status !== 'error' && status !== 'saving' && <span className="muted"> · {timeAgo(lastSyncAt, now)}</span>}
            </span>
          </div>
          {error && <div className="settings-error">{error}</div>}
          <label className="export-check">
            <input type="checkbox" checked={!!config.csvCopy} onChange={(e) => sync.setCsvCopy(e.target.checked)} />
            Also save a collection CSV next to it (Piltover Archive format)
          </label>
          <div className="settings-actions">
            <button className="btn" onClick={() => sync.syncNow()}>Sync now</button>
            <button className="btn" onClick={() => sync.chooseFile('existing')}>Change file…</button>
            {backupAvailable && (
              <button className="btn" onClick={() => sync.undoLastLoad()}
                title="Put back this computer's data from before the last time changes were loaded from another device">
                Undo last sync load
              </button>
            )}
            <button className="btn ghost danger" onClick={() => sync.disable()}>Turn off sync</button>
          </div>

          <div className="settings-subhead">Friends in this folder</div>
          {friends.length ? (
            <div className="settings-friends">
              {friends.map((f) => (
                <span key={f.id} className="settings-friend" title={f.id}>
                  {f.name} <span className="muted">· {timeAgo(f.savedAt, now)}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="settings-note small">None yet.</p>
          )}
          <p className="settings-note small">
            To compare collections, share this folder with friends (in Google Drive: right-click the folder → Share,
            then each friend adds it to their <b>My Drive</b> with "Add shortcut"). Each person uses <b>Create sync file…</b> to make
            their <b>own</b> sync file in it. Friends' files are only read here, never changed. Everyone in the
            folder can see your collection, decks and trade lists.
          </p>
        </>
      ) : (
        <>
          {error && <div className="settings-error">{error}</div>}
          <div className="settings-actions">
            <button className="btn primary" onClick={() => sync.chooseFile('new')}>Create sync file…</button>
            <button className="btn" onClick={() => sync.chooseFile('existing')}>Use existing sync file…</button>
          </div>
          <p className="settings-note small">
            First computer: <b>Create</b> a file in your synced folder. Other computers: <b>Use existing</b> and pick that same file.
          </p>
        </>
      )}
    </>
  );
}

function AppearanceSection() {
  const [current, setCurrent] = useState(loadThemeId);
  const pick = (id, e) => {
    if (id === current) return;
    switchTheme(id, e && e.clientX ? { x: e.clientX, y: e.clientY } : null);
    setCurrent(id);
  };
  return (
    <div className="theme-grid">
      {THEMES.map((t) => (
        <button
          key={t.id}
          data-theme={t.id}
          className={`theme-card${current === t.id ? ' theme-card--active' : ''}`}
          onClick={(e) => pick(t.id, e)}
          aria-pressed={current === t.id}
        >
          <span className="theme-card-art">
            {t.art ? <img src={t.art} alt="" loading="lazy" />
              : t.shapes ? <ThemeShapes className="theme-card-shapes" />
              : <ThemeSigil className="theme-card-sigil" />}
          </span>
          <span className="theme-card-strip" />
          <span className="theme-card-text">
            <span className="theme-card-name">{t.name}{current === t.id && <span className="theme-card-check">✓</span>}</span>
            <span className="theme-card-blurb">{t.blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function Settings({ allCards, collection, foilCollection, onImport }) {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    window.__electron__?.appVersion?.().then(setVersion).catch(() => {});
  }, []);

  return (
    <div className="settings-page">
      <section className="settings-card">
        <h2>Appearance</h2>
        <AppearanceSection />
        <p className="settings-note small">
          Theme art is from Riftbound cards and League of Legends splash art by Riot Games, used under Riot's Legal Jibber Jabber policy.
          Card Manager isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or
          anyone officially involved in producing or managing Riot Games properties. Riot Games and all
          associated properties are trademarks or registered trademarks of Riot Games, Inc.
        </p>
      </section>

      <section className="settings-card">
        <h2>Sync between devices</h2>
        <SyncSection />
      </section>

      <section className="settings-card">
        <h2>Collection CSV</h2>
        <p className="settings-note">
          Import or export this game's collection as a CSV (Piltover Archive format). Importing sets the counts for every card in the file.
        </p>
        <div className="settings-actions">
          <ImportButton allCards={allCards} onImport={onImport} />
          <ExportButton allCards={allCards} collection={collection} foilCollection={foilCollection} />
        </div>
      </section>

      <section className="settings-card">
        <h2>Updates</h2>
        <div className="settings-row">
          <span className="settings-label">Version</span>
          <span>{version ? `v${version}` : window.__electron__ ? '…' : 'Browser build'}</span>
        </div>
        <div className="settings-actions">
          <CheckForUpdatesButton />
        </div>
      </section>
    </div>
  );
}
