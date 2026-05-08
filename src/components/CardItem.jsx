import { useRef, useEffect } from 'react';
import { formatPlayset, isAlwaysFoil, isSingleton, isBattlefield } from '../utils/playset';

function PriceTag({ price, variant = 'normal', pricesLoading }) {
  if (pricesLoading) return <span className="card-price loading">…</span>;
  const p = price?.[variant];
  if (!p?.market) return null;
  return (
    <span className={`card-price${variant === 'foil' ? ' foil' : ''}`}>
      ${p.market.toFixed(2)}
    </span>
  );
}

function PlaysetCheckbox({ count, onSet }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < 3;
  }, [count]);
  return (
    <label className="playset-check-label" title="Quick-set playset (×3)">
      <input
        ref={ref}
        type="checkbox"
        className="playset-check"
        checked={count >= 3}
        onChange={(e) => onSet(e.target.checked ? 3 : 0)}
      />
      <span>×3</span>
    </label>
  );
}

// Simple "Have it" toggle for singleton cards (Legends, Battlefields)
function SingletonCounter({ cardId, count, foilCount, showFoil, onAdjust, onAdjustFoil }) {
  return (
    <div className="card-singleton">
      <label className="singleton-check-label">
        <input
          type="checkbox"
          checked={count > 0}
          onChange={(e) => onAdjust(cardId, e.target.checked ? 1 : -count)}
        />
        <span>Have it</span>
      </label>
      {showFoil && (
        <label className="singleton-check-label">
          <input
            type="checkbox"
            checked={foilCount > 0}
            onChange={(e) => onAdjustFoil(cardId, e.target.checked ? 1 : -foilCount)}
          />
          <span>✦ Foil</span>
        </label>
      )}
    </div>
  );
}

// A single +/- row with the playset checkbox
// foilCount is optional — when provided, the checkbox reflects the combined total
function Counter({ cardId, count, foilCount = 0, onAdjust, label }) {
  const total = count + foilCount;
  return (
    <div className="card-controls">
      <PlaysetCheckbox count={total} onSet={(n) => onAdjust(cardId, Math.max(0, n - foilCount) - count)} />
      <button onClick={() => onAdjust(cardId, -1)} disabled={count === 0} aria-label={`Remove ${label}`}>−</button>
      <span className="card-count">{count}</span>
      <button onClick={() => onAdjust(cardId, 1)} aria-label={`Add ${label}`}>+</button>
    </div>
  );
}

// Renders one card's counters — alwaysFoil cards get a single foil counter,
// normal cards get a normal counter + a separate foil row.
function CardCounters({ card, count, foilCount, price, pricesLoading, onAdjust, onAdjustFoil, alwaysFoil }) {
  const label     = formatPlayset(alwaysFoil ? foilCount : count + foilCount);
  const foilLabel = formatPlayset(foilCount);
  const foilPrice = price?.foil?.market != null;

  if (alwaysFoil) {
    return (
      <>
        <Counter
          cardId={card.id}
          count={foilCount}
          onAdjust={onAdjustFoil}
          label="foil"
        />
        <div className="card-playset">{label ?? ' '}</div>
      </>
    );
  }

  return (
    <>
      <Counter cardId={card.id} count={count} foilCount={foilCount} onAdjust={onAdjust} label="one" />
      <div className="card-playset">{label ?? ' '}</div>
      <div className="card-foil">
        <div className="card-foil-label">
          Foil
          <PriceTag price={price} variant="foil" pricesLoading={foilPrice ? pricesLoading : false} />
        </div>
        <div className="card-controls">
          <button onClick={() => onAdjustFoil(card.id, -1)} disabled={foilCount === 0} aria-label="Remove foil">−</button>
          <span className="card-count">{foilCount}</span>
          <button onClick={() => onAdjustFoil(card.id, 1)} aria-label="Add foil">+</button>
        </div>
        <div className="card-playset">{foilLabel ?? ' '}</div>
      </div>
    </>
  );
}

export default function CardItem({ card, count, foilCount, price, alts = [], pricesLoading, onAdjust, onAdjustFoil, onOpenModal, lookingFor = {}, upForTrade = {}, onToggleLF, onToggleUFT }) {
  const alwaysFoil = isAlwaysFoil(card);
  const singleton = isSingleton(card);
  const battlefield = isBattlefield(card);
  const effectiveCount = alwaysFoil ? foilCount : count + foilCount;
  const imgSrc = card.media?.image_url ?? null;

  let className = 'card-item';
  if (effectiveCount > 0 || (!alwaysFoil && foilCount > 0)) className += ' owned';
  if (!singleton && effectiveCount >= 3) className += ' playset';

  return (
    <div className={className}>
      <div className="card-img-btn" onClick={() => onOpenModal?.(card)} title="Click to view">
        {imgSrc
          ? <img className="card-img" src={imgSrc} alt={card.name} loading="lazy" />
          : <div className="card-img-placeholder">{card.name}</div>}
      </div>

      <div className="card-name">
        {card.name}
        {alwaysFoil && <span className="card-foil-badge">✦</span>}
        <PriceTag
          price={price}
          variant={alwaysFoil ? 'foil' : 'normal'}
          pricesLoading={pricesLoading}
        />
      </div>

      {singleton ? (
        <SingletonCounter
          cardId={card.id}
          count={count}
          foilCount={foilCount}
          showFoil={battlefield}
          onAdjust={onAdjust}
          onAdjustFoil={onAdjustFoil}
        />
      ) : (
        <CardCounters
          card={card}
          count={count}
          foilCount={foilCount}
          price={price}
          pricesLoading={pricesLoading}
          onAdjust={onAdjust}
          onAdjustFoil={onAdjustFoil}
          alwaysFoil={alwaysFoil}
        />
      )}
      <div className="card-trade-buttons">
        <button
          className={`trade-btn lf${lookingFor[card.id] ? ' active' : ''}`}
          onClick={() => onToggleLF?.(card.id)}
          title="Looking For"
        >LF</button>
        <button
          className={`trade-btn uft${upForTrade[card.id] ? ' active' : ''}`}
          onClick={() => onToggleUFT?.(card.id)}
          title="Up For Trade"
        >UFT</button>
      </div>

      {/* Alt art cards are always foil */}
      {alts.map(({ card: alt, count: altCount, foilCount: altFoilCount, price: altPrice }) => {
        const altAlwaysFoil = isAlwaysFoil(alt);
        const altEffective = altAlwaysFoil ? (altFoilCount ?? 0) : altCount + (altFoilCount ?? 0);
        const altLabel = formatPlayset(altEffective);
        return (
          <div key={alt.id} className="card-alt">
            <div className="card-alt-label">
              Alt Art ✦
              <PriceTag price={altPrice} variant={altAlwaysFoil ? 'foil' : 'normal'} pricesLoading={pricesLoading} />
            </div>
            {altAlwaysFoil ? (
              <>
                <Counter
                  cardId={alt.id}
                  count={altFoilCount ?? 0}
                  onAdjust={onAdjustFoil}
                  label="alt foil"
                />
                <div className="card-playset">{altLabel ?? ' '}</div>
              </>
            ) : (
              <>
                <Counter cardId={alt.id} count={altCount} foilCount={altFoilCount ?? 0} onAdjust={onAdjust} label="alt" />
                <div className="card-playset">{altLabel ?? ' '}</div>
                <div className="card-foil">
                  <div className="card-foil-label">Foil</div>
                  <div className="card-controls">
                    <button onClick={() => onAdjustFoil(alt.id, -1)} disabled={(altFoilCount ?? 0) === 0}>−</button>
                    <span className="card-count">{altFoilCount ?? 0}</span>
                    <button onClick={() => onAdjustFoil(alt.id, 1)}>+</button>
                  </div>
                  <div className="card-playset">{formatPlayset(altFoilCount ?? 0) ?? ' '}</div>
                </div>
              </>
            )}
            <div className="card-trade-buttons">
              <button
                className={`trade-btn lf${lookingFor[alt.id] ? ' active' : ''}`}
                onClick={() => onToggleLF?.(alt.id)}
                title="Looking For"
              >LF</button>
              <button
                className={`trade-btn uft${upForTrade[alt.id] ? ' active' : ''}`}
                onClick={() => onToggleUFT?.(alt.id)}
                title="Up For Trade"
              >UFT</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
