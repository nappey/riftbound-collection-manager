import { useMemo, useState, useCallback } from 'react';
import { SET_ORDER, SET_LABELS } from '../utils/generateExport';
import { isPlaysetEligible, cardTarget, ownedTotal, unitPrice, fmt$ } from '../utils/analysis';

export default function Shopping({
  allCards, collection, foilCollection, prices, pricesLoading,
  lookingFor, onToggleLF, onOpenModal,
}) {
  const [scope, setScope] = useState('progress'); // 'progress' | 'all'
  const [sort, setSort]   = useState('set');       // 'set' | 'cost' | 'name'

  // Build the list of needed copies.
  const needed = useMemo(() => {
    const rows = [];
    for (const card of allCards) {
      if (!isPlaysetEligible(card)) continue;
      const owned  = ownedTotal(card, collection, foilCollection);
      const target = cardTarget(card);
      if (owned >= target) continue;
      if (scope === 'progress' && owned === 0) continue;
      const price = unitPrice(card, prices);
      const need  = target - owned;
      rows.push({ card, owned, target, need, price, lineCost: (price ?? 0) * need });
    }
    return rows;
  }, [allCards, collection, foilCollection, prices, scope]);

  const totals = useMemo(() => ({
    unique: needed.length,
    copies: needed.reduce((n, r) => n + r.need, 0),
    cost:   needed.reduce((n, r) => n + r.lineCost, 0),
  }), [needed]);

  // Group by set, applying the chosen ordering inside each group.
  const groups = useMemo(() => {
    const bySet = {};
    for (const row of needed) {
      const sid = row.card.set?.set_id ?? 'UNK';
      (bySet[sid] = bySet[sid] || []).push(row);
    }
    const setIds = [
      ...SET_ORDER.filter(s => bySet[s]),
      ...Object.keys(bySet).filter(s => !SET_ORDER.includes(s)),
    ];
    const cmp = sort === 'cost'
      ? (a, b) => b.lineCost - a.lineCost
      : sort === 'name'
      ? (a, b) => a.card.name.localeCompare(b.card.name)
      : (a, b) => (a.card.collector_number ?? 0) - (b.card.collector_number ?? 0);
    return setIds.map(sid => {
      const rows = [...bySet[sid]].sort(cmp);
      return {
        sid,
        label: SET_LABELS[sid] ?? sid,
        rows,
        subtotal: rows.reduce((n, r) => n + r.lineCost, 0),
        copies: rows.reduce((n, r) => n + r.need, 0),
      };
    });
  }, [needed, sort]);

  const [copied, setCopied] = useState(false);
  const copyBuyList = useCallback(async () => {
    let out = `Riftbound Buy List — ${totals.copies} cards · est. ${fmt$(totals.cost)}\n\n`;
    for (const g of groups) {
      out += `${g.label}\n`;
      for (const r of g.rows) {
        out += `${r.need}x ${r.card.name}${r.price != null ? `  (${fmt$(r.price)} ea)` : ''}\n`;
      }
      out += '\n';
    }
    await navigator.clipboard.writeText(out.trimEnd());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [groups, totals]);

  return (
    <div className="shop-wrap">
      <div className="shop-head">
        <div>
          <h1>Shopping List</h1>
          <p>Everything you still need to finish playsets{scope === 'progress' ? ' you’ve started' : ''}.</p>
        </div>
        <div className="shop-summary">
          <div className="shop-stat">
            <span className="shop-stat-label">Cards</span>
            <span className="shop-stat-value">{totals.copies}</span>
          </div>
          <div className="shop-stat">
            <span className="shop-stat-label">Unique</span>
            <span className="shop-stat-value">{totals.unique}</span>
          </div>
          <div className="shop-stat">
            <span className="shop-stat-label">Est. cost</span>
            <span className="shop-stat-value accent">{pricesLoading ? '…' : fmt$(totals.cost)}</span>
          </div>
        </div>
      </div>

      <div className="shop-toolbar">
        <div className="seg">
          <button className={scope === 'progress' ? 'active' : ''} onClick={() => setScope('progress')}>In progress</button>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>All missing</button>
        </div>
        <div className="seg">
          <span className="seg-label">Sort</span>
          <button className={sort === 'set' ? 'active' : ''} onClick={() => setSort('set')}>Number</button>
          <button className={sort === 'cost' ? 'active' : ''} onClick={() => setSort('cost')}>Cost</button>
          <button className={sort === 'name' ? 'active' : ''} onClick={() => setSort('name')}>Name</button>
        </div>
        <button className="btn" style={{ marginLeft: 'auto' }} disabled={!needed.length} onClick={copyBuyList}>
          {copied ? '✓ Copied' : 'Copy buy list'}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="status-placeholder">
          {scope === 'progress'
            ? 'No partial playsets — start collecting some cards and they’ll show up here.'
            : '🎉 Every playset is complete. Nothing to buy!'}
        </div>
      ) : (
        <div className="shop-groups">
          {groups.map(g => (
            <div key={g.sid} className="shop-group">
              <div className="shop-group-head">
                <span className="shop-group-title">{g.label}</span>
                <span className="shop-group-meta">
                  {g.copies} card{g.copies !== 1 ? 's' : ''}
                  {!pricesLoading && g.subtotal > 0 && <span className="shop-group-cost"> · {fmt$(g.subtotal)}</span>}
                </span>
              </div>
              {g.rows.map(({ card, owned, target, need, price, lineCost }) => (
                <div key={card.id} className="shop-row">
                  <span className="shop-need">{need}×</span>
                  <button className="shop-thumb" onClick={() => onOpenModal?.(card)} title="View details">
                    {card.media?.image_url ? <img src={card.media.image_url} alt={card.name} loading="lazy" /> : null}
                  </button>
                  <div className="shop-name-col">
                    <span className="shop-name">{card.name}</span>
                    <span className="shop-owned">have {owned}/{target}</span>
                  </div>
                  <span className="shop-price">{pricesLoading ? '…' : price != null ? `${fmt$(price)} ea` : '—'}</span>
                  <span className="shop-line">{pricesLoading ? '' : lineCost > 0 ? fmt$(lineCost) : '—'}</span>
                  <button
                    className={`tag-btn lf-tag${lookingFor[card.id] ? ' active lf' : ''}`}
                    onClick={() => onToggleLF?.(card.id)}
                    title="Add to Looking For list"
                  >LF</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
