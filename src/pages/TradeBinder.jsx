import { useMemo, useState, useCallback } from 'react';
import { SET_ORDER, SET_LABELS } from '../utils/generateExport';
import { cardTarget, ownedTotal, unitPrice, fmt$ } from '../utils/analysis';

// Order cards within a list by set, then collector number.
function sortForList(cards) {
  return [...cards].sort((a, b) => {
    const sa = SET_ORDER.indexOf(a.set?.set_id);
    const sb = SET_ORDER.indexOf(b.set?.set_id);
    if (sa !== sb) return (sa === -1 ? 99 : sa) - (sb === -1 ? 99 : sb);
    return (a.collector_number ?? 0) - (b.collector_number ?? 0);
  });
}

function ListColumn({
  title, accent, cards, emptyHint, prices, pricesLoading,
  collection, foilCollection, onRemove, onOpenModal, showSpare,
}) {
  const total = useMemo(
    () => cards.reduce((sum, c) => sum + (unitPrice(c, prices) ?? 0), 0),
    [cards, prices]
  );

  const [copied, setCopied] = useState(false);
  const copyList = useCallback(async () => {
    if (!cards.length) return;
    const lines = sortForList(cards).map(c => {
      const isAlt = c.metadata?.alternate_art ? ' (Alt Art)' : '';
      return `${c.name}${isAlt} — ${SET_LABELS[c.set?.set_id] ?? c.set?.set_id ?? '?'}`;
    });
    await navigator.clipboard.writeText(`${title}:\n` + lines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [cards, title]);

  return (
    <div className="trade-col">
      <div className="trade-col-head" style={{ borderColor: accent }}>
        <div>
          <h2 style={{ color: accent }}>{title}</h2>
          <span className="trade-col-sub">{cards.length} card{cards.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="trade-col-actions">
          {!pricesLoading && total > 0 && <span className="trade-col-value">{fmt$(total)}</span>}
          <button className="btn ghost" disabled={!cards.length} onClick={copyList}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="trade-empty">{emptyHint}</div>
      ) : (
        <div className="trade-list">
          {sortForList(cards).map(card => {
            const price = unitPrice(card, prices);
            const owned = ownedTotal(card, collection, foilCollection);
            const spare = Math.max(0, owned - cardTarget(card));
            return (
              <div key={card.id} className="trade-row">
                <button className="trade-thumb" onClick={() => onOpenModal?.(card)} title="View details">
                  {card.media?.image_url
                    ? <img src={card.media.image_url} alt={card.name} loading="lazy" />
                    : null}
                </button>
                <div className="trade-info">
                  <span className="trade-name">{card.name}</span>
                  <span className="trade-set">
                    {SET_LABELS[card.set?.set_id] ?? card.set?.set_id}
                    {card.metadata?.alternate_art && <span className="trade-alt"> · Alt Art</span>}
                  </span>
                </div>
                {showSpare && spare > 0 && (
                  <span className="trade-spare" title="Spare copies beyond a playset">{spare} spare</span>
                )}
                <span className="trade-price">
                  {pricesLoading ? '…' : price != null ? fmt$(price) : '—'}
                </span>
                <button className="trade-remove" onClick={() => onRemove(card.id)} title="Remove from list">×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function TradeBinder({
  allCards, collection, foilCollection, prices, pricesLoading,
  lookingFor, upForTrade, onToggleLF, onToggleUFT, onOpenModal,
}) {
  const lfCards = useMemo(
    () => allCards.filter(c => lookingFor[c.id]),
    [allCards, lookingFor]
  );
  const uftCards = useMemo(
    () => allCards.filter(c => upForTrade[c.id]),
    [allCards, upForTrade]
  );

  return (
    <div className="trade-wrap">
      <div className="trade-intro">
        <h1>Trade Binder</h1>
        <p>Cards you've flagged across your collection. Mark cards with the <b>LF</b> and <b>UFT</b> tags
          on any card to populate these lists, then copy them to share with trade partners.</p>
      </div>
      <div className="trade-cols">
        <ListColumn
          title="Up For Trade"
          accent="var(--ok)"
          cards={uftCards}
          emptyHint="No cards flagged for trade yet. Hit the UFT tag on cards you have spares of."
          prices={prices}
          pricesLoading={pricesLoading}
          collection={collection}
          foilCollection={foilCollection}
          onRemove={onToggleUFT}
          onOpenModal={onOpenModal}
          showSpare
        />
        <ListColumn
          title="Looking For"
          accent="var(--accent)"
          cards={lfCards}
          emptyHint="Nothing on your wishlist yet. Hit the LF tag on cards you want."
          prices={prices}
          pricesLoading={pricesLoading}
          collection={collection}
          foilCollection={foilCollection}
          onRemove={onToggleLF}
          onOpenModal={onOpenModal}
        />
      </div>
    </div>
  );
}
