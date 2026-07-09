import { useEffect, useMemo, useRef, useState } from 'react';

// Scalable replacement for the horizontal set-tab strip: a trigger button that
// opens a grouped, filterable dropdown of every set (plus Rune Box / Promos),
// each row showing collection progress. Stays compact no matter how many sets
// ship. `entries` items: { id, label, kind, owned, total, pct }.
export default function SetPicker({ entries, currentId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = entries.find((e) => e.id === currentId) ?? entries[0];

  const { sets, special } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = q ? entries.filter((e) => e.label.toLowerCase().includes(q)) : entries;
    return {
      sets: shown.filter((e) => e.kind === 'set' || e.kind === 'promoSet'),
      special: shown.filter((e) => e.kind === 'runes' || e.kind === 'promos'),
    };
  }, [entries, query]);

  const choose = (id) => { onSelect(id); setOpen(false); setQuery(''); };

  const Row = (e) => (
    <button
      key={e.id}
      className={`sp-row k-${e.kind}${e.id === currentId ? ' active' : ''}`}
      onClick={() => choose(e.id)}
      role="option"
      aria-selected={e.id === currentId}
    >
      <span className="sp-row-name">{e.label}</span>
      <span className="sp-row-bar"><span className="sp-row-fill" style={{ width: `${e.pct}%` }} /></span>
      <span className="sp-row-pct">{e.pct}%</span>
      <span className="sp-row-count">{e.owned}/{e.total}</span>
    </button>
  );

  return (
    <div className="set-picker" ref={ref}>
      <button
        className={`sp-trigger k-${current?.kind ?? 'set'}${open ? ' open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="sp-trigger-main">
          <span className="sp-trigger-label">Set</span>
          <span className="sp-trigger-name">{current?.label ?? 'Select a set'}</span>
        </span>
        <span className="sp-trigger-meta">{current?.pct ?? 0}% · {current?.owned ?? 0}/{current?.total ?? 0}</span>
        <span className={`sp-chevron${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="sp-menu" role="listbox">
          {entries.length > 8 && (
            <input
              className="sp-search"
              autoFocus
              placeholder="Filter sets…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="sp-list">
            {sets.length > 0 && <div className="sp-group">Sets</div>}
            {sets.map(Row)}
            {special.length > 0 && <div className="sp-group">Collections</div>}
            {special.map(Row)}
            {sets.length === 0 && special.length === 0 && <div className="sp-empty">No sets match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
