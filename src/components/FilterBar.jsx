const TYPES = ['Unit', 'Spell', 'Gear', 'Rune', 'Legend'];
const RARITIES = ['Common', 'Uncommon', 'Rare', 'Showcase'];
const DOMAINS = ['Body', 'Calm', 'Chaos', 'Colorless', 'Fury', 'Mind', 'Order'];
const STATUSES = [
  { value: 'all', label: 'All cards' },
  { value: 'owned', label: 'Owned' },
  { value: 'missing', label: 'Missing' },
  { value: 'playset', label: 'Playset ✓' },
  { value: 'incomplete', label: 'Incomplete playset' },
];
const SORTS = [
  { value: 'collector_number', label: 'Collector #' },
  { value: 'name', label: 'Name' },
  { value: 'rarity', label: 'Rarity' },
  { value: 'energy', label: 'Energy cost' },
  { value: 'count', label: 'Owned count' },
];

export default function FilterBar({ filters, sort, onChange, onSortChange }) {
  function set(key, val) {
    onChange({ ...filters, [key]: val });
  }

  function toggleDir() {
    onSortChange({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
  }

  const active =
    filters.search || filters.type || filters.rarity || filters.domain || filters.status !== 'all';

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <input
          className="filter-search"
          type="search"
          placeholder="Search cards…"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
        />

        <select
          className="filter-select"
          value={filters.type}
          onChange={(e) => set('type', e.target.value)}
        >
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <select
          className="filter-select"
          value={filters.rarity}
          onChange={(e) => set('rarity', e.target.value)}
        >
          <option value="">All rarities</option>
          {RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <select
          className="filter-select"
          value={filters.domain}
          onChange={(e) => set('domain', e.target.value)}
        >
          <option value="">All domains</option>
          {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>

        <select
          className="filter-select"
          value={filters.status}
          onChange={(e) => set('status', e.target.value)}
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      <div className="filter-row sort-row">
        <span className="sort-label">Sort:</span>
        <select
          className="filter-select"
          value={sort.field}
          onChange={(e) => onSortChange({ ...sort, field: e.target.value })}
        >
          {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="sort-dir-btn" onClick={toggleDir} title="Toggle direction">
          {sort.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
        </button>
        {active && (
          <button
            className="filter-clear-btn"
            onClick={() => onChange({ search: '', type: '', rarity: '', domain: '', status: 'all' })}
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
