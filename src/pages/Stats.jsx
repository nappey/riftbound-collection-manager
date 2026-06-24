import { useMemo } from 'react';
import { SET_ORDER, SET_LABELS } from '../utils/generateExport';
import {
  isPlaysetEligible, cardTarget, ownedTotal, cardMarketValue, fmt$,
} from '../utils/analysis';

const DOMAINS = ['body', 'calm', 'chaos', 'fury', 'mind', 'order', 'colorless'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'showcase'];

function BarRow({ label, owned, total, color, valueText }) {
  const pct = total ? Math.round((owned / total) * 100) : 0;
  return (
    <div className="bar-row">
      <span className="bar-label" style={color ? { color } : undefined}>{label}</span>
      <div className="bar-track">
        <span className="bar-fill" style={{ width: pct + '%', background: color ?? 'var(--accent)' }} />
      </div>
      <span className="bar-value">{valueText ?? `${owned}/${total}`}</span>
      <span className="bar-pct">{pct}%</span>
    </div>
  );
}

export default function Stats({ allCards, collection, foilCollection, prices, pricesLoading, onOpenModal }) {
  const stats = useMemo(() => {
    const eligible = allCards.filter(isPlaysetEligible);
    const runes = allCards.filter(c => c.classification?.type === 'Rune');
    const tracked = [...eligible, ...runes];

    let uniqueOwned = 0, playsetsDone = 0, normalCopies = 0, foilCopies = 0;
    let normalValue = 0, foilValue = 0;

    const byDomain = Object.fromEntries(DOMAINS.map(d => [d, { owned: 0, total: 0 }]));
    const byRarity = Object.fromEntries(RARITIES.map(r => [r, { owned: 0, total: 0 }]));
    const bySetValue = {};
    const valuedCards = [];

    for (const card of tracked) {
      const n = collection[card.id] ?? 0;
      const f = foilCollection[card.id] ?? 0;
      normalCopies += n; foilCopies += f;
      const owned = ownedTotal(card, collection, foilCollection);
      const isOwned = owned > 0;
      if (isOwned) uniqueOwned++;
      if (owned >= cardTarget(card)) playsetsDone++;

      const dom = (card.classification?.domain?.[0] ?? 'colorless').toLowerCase();
      if (byDomain[dom]) { byDomain[dom].total++; if (isOwned) byDomain[dom].owned++; }
      const rar = (card.classification?.rarity ?? '').toLowerCase();
      if (byRarity[rar]) { byRarity[rar].total++; if (isOwned) byRarity[rar].owned++; }

      const p = prices[card.tcgplayer_id] ?? {};
      normalValue += n * (p.normal?.market ?? 0);
      foilValue   += f * (p.foil?.market ?? p.normal?.market ?? 0);

      const val = cardMarketValue(card, collection, foilCollection, prices);
      if (val > 0) {
        const sid = card.set?.set_id ?? 'UNK';
        bySetValue[sid] = (bySetValue[sid] ?? 0) + val;
        valuedCards.push({ card, val });
      }
    }

    const totalValue = normalValue + foilValue;
    const setValueRows = [
      ...SET_ORDER.filter(s => bySetValue[s]),
      ...Object.keys(bySetValue).filter(s => !SET_ORDER.includes(s)),
    ].map(sid => ({ sid, label: SET_LABELS[sid] ?? sid, value: bySetValue[sid] }));
    const maxSetValue = Math.max(1, ...setValueRows.map(r => r.value));

    valuedCards.sort((a, b) => b.val - a.val);

    return {
      total: tracked.length, uniqueOwned, playsetsDone,
      normalCopies, foilCopies, normalValue, foilValue, totalValue,
      byDomain, byRarity, setValueRows, maxSetValue,
      topCards: valuedCards.slice(0, 12),
    };
  }, [allCards, collection, foilCollection, prices]);

  return (
    <div className="stats-wrap">
      <h1 className="stats-title">Collection Stats</h1>

      {/* Headline numbers */}
      <div className="stats-cards">
        <div className="stats-card">
          <span className="stats-card-label">Total value</span>
          <span className="stats-card-value accent">{pricesLoading ? '…' : fmt$(stats.totalValue)}</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Unique owned</span>
          <span className="stats-card-value">{stats.uniqueOwned}<span className="stats-card-sub">/{stats.total}</span></span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Playsets complete</span>
          <span className="stats-card-value">{stats.playsetsDone}</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Total copies</span>
          <span className="stats-card-value">{stats.normalCopies + stats.foilCopies}</span>
        </div>
        <div className="stats-card">
          <span className="stats-card-label">Foils owned</span>
          <span className="stats-card-value foil">✦ {stats.foilCopies}</span>
        </div>
      </div>

      <div className="stats-grid">
        {/* Completion by domain */}
        <div className="stats-panel">
          <h2>Completion by domain</h2>
          {DOMAINS.filter(d => stats.byDomain[d].total > 0).map(d => (
            <BarRow
              key={d}
              label={d.charAt(0).toUpperCase() + d.slice(1)}
              owned={stats.byDomain[d].owned}
              total={stats.byDomain[d].total}
              color={`var(--d-${d})`}
            />
          ))}
        </div>

        {/* Completion by rarity */}
        <div className="stats-panel">
          <h2>Completion by rarity</h2>
          {RARITIES.filter(r => stats.byRarity[r].total > 0).map(r => (
            <BarRow
              key={r}
              label={r.charAt(0).toUpperCase() + r.slice(1)}
              owned={stats.byRarity[r].owned}
              total={stats.byRarity[r].total}
              color={`var(--r-${r})`}
            />
          ))}
        </div>

        {/* Value by set */}
        <div className="stats-panel">
          <h2>Value by set</h2>
          {pricesLoading ? (
            <div className="stats-muted">Loading prices…</div>
          ) : stats.setValueRows.length === 0 ? (
            <div className="stats-muted">No owned cards yet.</div>
          ) : stats.setValueRows.map(r => (
            <div key={r.sid} className="bar-row">
              <span className="bar-label">{r.label}</span>
              <div className="bar-track">
                <span className="bar-fill" style={{ width: (r.value / stats.maxSetValue) * 100 + '%' }} />
              </div>
              <span className="bar-value">{fmt$(r.value)}</span>
            </div>
          ))}
        </div>

        {/* Foil vs normal */}
        <div className="stats-panel">
          <h2>Foil vs normal</h2>
          <BarRow label="Normal" owned={stats.normalCopies} total={stats.normalCopies + stats.foilCopies}
            color="var(--text-2)" valueText={`${stats.normalCopies} copies`} />
          <BarRow label="Foil" owned={stats.foilCopies} total={stats.normalCopies + stats.foilCopies}
            color="var(--warn)" valueText={`${stats.foilCopies} copies`} />
          {!pricesLoading && (
            <div className="stats-split">
              <span>Normal value <b>{fmt$(stats.normalValue)}</b></span>
              <span>Foil value <b style={{ color: 'var(--warn)' }}>{fmt$(stats.foilValue)}</b></span>
            </div>
          )}
        </div>
      </div>

      {/* Most valuable */}
      <div className="stats-panel">
        <h2>Most valuable cards</h2>
        {stats.topCards.length === 0 ? (
          <div className="stats-muted">{pricesLoading ? 'Loading prices…' : 'No owned cards with a price yet.'}</div>
        ) : (
          <div className="top-cards">
            {stats.topCards.map(({ card, val }) => (
              <button key={card.id} className="top-card" onClick={() => onOpenModal?.(card)} title="View details">
                <div className="top-card-thumb">
                  {card.media?.image_url ? <img src={card.media.image_url} alt={card.name} loading="lazy" /> : null}
                </div>
                <span className="top-card-name">{card.name}</span>
                <span className="top-card-val">{fmt$(val)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
