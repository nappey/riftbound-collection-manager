import { useMemo } from 'react';

const TYPES = ['Unit', 'Spell', 'Gear', 'Legend', 'Battlefield'];
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Showcase'];
const DOMAINS = ['Body', 'Calm', 'Chaos', 'Colorless', 'Fury', 'Mind', 'Order'];
const STATUSES = [
  { value: 'all', label: 'All' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
  { value: 'playset', label: 'Playset ✓' },
  { value: 'incomplete', label: 'Incomplete' },
];
const SORTS = [
  { value: 'collector_number', label: 'Collector #' },
  { value: 'name', label: 'Name' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'energy', label: 'Energy' },
  { value: 'count', label: 'Owned count' },
];

function FilterGroup({ label, options, value, allLabel = 'All', onChange, counts = {} }) {
  return (
    <div className="filter-group">
      <div className="filter-group-head">
        <span className="filter-label">{label}</span>
        {value && <button className="filter-clear-link" onClick={() => onChange('')}>Clear</button>}
      </div>
      <div className="chip-list">
        <button
          className={`chip${!value ? ' active' : ''}`}
          onClick={() => onChange('')}
        >{allLabel}</button>
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const l = typeof opt === 'string' ? opt : opt.label;
          const count = counts[v] ?? counts[v?.toLowerCase()];
          return (
            <button
              key={v}
              className={`chip${value === v ? ' active' : ''}`}
              onClick={() => onChange(value === v ? '' : v)}
            >
              {v !== 'all' && DOMAINS.includes(v) && (
                <span className="chip-dot" style={{'--c': `var(--d-${v.toLowerCase()})`}}></span>
              )}
              {l}
              {count != null && <span className="chip-num">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function FilterBar({ filters, sort, onChange, onSortChange, allCards = [] }) {
  function set(key, val) {
    onChange({ ...filters, [key]: val });
  }

  const counts = useMemo(() => {
    const t = {}, r = {}, d = {};
    allCards.forEach(c => {
      const type = c.classification?.type;
      if (type) t[type] = (t[type] || 0) + 1;
      const rarity = c.classification?.rarity;
      if (rarity) r[rarity] = (r[rarity] || 0) + 1;
      const domains = c.classification?.domain ?? [];
      domains.forEach(dom => { d[dom] = (d[dom] || 0) + 1; });
    });
    return { t, r, d };
  }, [allCards]);

  return (
    <aside className="sidebar">
      <FilterGroup
        label="Type"
        options={TYPES}
        value={filters.type}
        onChange={(v) => set('type', v)}
        counts={counts.t}
      />
      <FilterGroup
        label="Rarity"
        options={RARITIES}
        value={filters.rarity}
        onChange={(v) => set('rarity', v)}
        counts={counts.r}
      />
      <FilterGroup
        label="Domain"
        options={DOMAINS}
        value={filters.domain}
        onChange={(v) => set('domain', v)}
        counts={counts.d}
      />
      <FilterGroup
        label="Status"
        options={STATUSES}
        value={filters.status === 'all' ? '' : filters.status}
        allLabel="All"
        onChange={(v) => set('status', v || 'all')}
      />
      <div className="sidebar-sort">
        <span className="sidebar-sort-label">Sort</span>
        <div className="sidebar-sort-controls">
          <select
            className="select-mini"
            value={sort.field}
            onChange={(e) => onSortChange({ ...sort, field: e.target.value })}
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button
            className="sort-dir-btn"
            onClick={() => onSortChange({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
          >
            {sort.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>
    </aside>
  );
}
