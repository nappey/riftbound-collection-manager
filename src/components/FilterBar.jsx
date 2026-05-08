const TYPES = ['Unit', 'Spell', 'Gear', 'Rune', 'Legend', 'Battlefield'];
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
  { value: 'energy', label: 'Energy cost' },
  { value: 'count', label: 'Owned count' },
];

function ChipGroup({ label, options, value, allLabel = 'All', onChange }) {
  return (
    <div className="filter-chip-group">
      <span className="filter-chip-label">{label}</span>
      <div className="filter-chips">
        <button
          className={`filter-chip${!value ? ' active' : ''}`}
          onClick={() => onChange('')}
        >{allLabel}</button>
        {options.map((opt) => {
          const v = typeof opt === 'string' ? opt : opt.value;
          const l = typeof opt === 'string' ? opt : opt.label;
          return (
            <button
              key={v}
              className={`filter-chip${value === v ? ' active' : ''}`}
              onClick={() => onChange(value === v ? '' : v)}
            >{l}</button>
          );
        })}
      </div>
    </div>
  );
}

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
      </div>

      <ChipGroup label="Type"   options={TYPES}    value={filters.type}   onChange={(v) => set('type', v)} />
      <ChipGroup label="Rarity" options={RARITIES}  value={filters.rarity} onChange={(v) => set('rarity', v)} />
      <ChipGroup label="Domain" options={DOMAINS}   value={filters.domain} onChange={(v) => set('domain', v)} />
      <ChipGroup label="Status" options={STATUSES}  value={filters.status === 'all' ? '' : filters.status} allLabel="All" onChange={(v) => set('status', v || 'all')} />

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
