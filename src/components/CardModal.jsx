import { useEffect } from 'react';

// Clean riftbound symbol codes from card text
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/:rb_energy_(\d+):/g, '[$1]')
    .replace(/:rb_rune_(\w+):/g, (_, r) => `[${r.charAt(0).toUpperCase() + r.slice(1)}]`)
    .replace(/\[&gt;\]/g, '→')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function StatPill({ label, value }) {
  if (value == null) return null;
  return (
    <div className="modal-stat">
      <span className="modal-stat-label">{label}</span>
      <span className="modal-stat-value">{value}</span>
    </div>
  );
}

const RARITY_COLOR = {
  common:   '#9090a8',
  uncommon: '#4ade80',
  rare:     '#60a5fa',
  showcase: '#f59e0b',
  promo:    '#f472b6',
};

export default function CardModal({ card, price, pricesLoading, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!card) return null;

  const imgSrc     = card.media?.image_url ?? null;
  const rarity     = card.classification?.rarity?.toLowerCase() ?? '';
  const rarityColor = RARITY_COLOR[rarity] ?? '#9090a8';
  const type       = [card.classification?.supertype, card.classification?.type].filter(Boolean).join(' ');
  const domains    = card.classification?.domain ?? [];
  const attrs      = card.attributes ?? {};
  const hasStats   = attrs.energy != null || attrs.might != null || attrs.power != null;
  const cardText   = cleanText(card.text?.plain ?? '');
  const flavour    = card.text?.flavour ?? '';
  const normalPrice = price?.normal?.market;
  const foilPrice   = price?.foil?.market;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>

        {/* Left — card image */}
        <div className="modal-img-wrap">
          {imgSrc
            ? <img className="modal-img" src={imgSrc} alt={card.name} />
            : <div className="modal-img-placeholder">{card.name}</div>}
        </div>

        {/* Right — details */}
        <div className="modal-details">
          <div className="modal-header">
            <h2 className="modal-name">{card.name}</h2>
            <div className="modal-meta">
              <span className="modal-type">{type}</span>
              <span className="modal-rarity" style={{ color: rarityColor }}>
                {card.classification?.rarity}
              </span>
            </div>
          </div>

          <div className="modal-tags-row">
            <span className="modal-set">{card.set?.label} #{String(card.collector_number).padStart(3, '0')}</span>
            {domains.map((d) => (
              <span key={d} className="modal-domain">{d}</span>
            ))}
            {card.tags?.filter(t => !domains.includes(t)).slice(0, 4).map((t) => (
              <span key={t} className="modal-tag">{t}</span>
            ))}
          </div>

          {hasStats && (
            <div className="modal-stats">
              <StatPill label="Energy" value={attrs.energy} />
              <StatPill label="Might"  value={attrs.might} />
              <StatPill label="Power"  value={attrs.power} />
            </div>
          )}

          {cardText && (
            <div className="modal-text">
              {cardText.split(/(?=\[Level \d+\])/).map((chunk, i) => (
                <p key={i}>{chunk.trim()}</p>
              ))}
            </div>
          )}

          {flavour && <p className="modal-flavour">"{flavour}"</p>}

          <div className="modal-footer">
            {card.media?.artist && (
              <span className="modal-artist">Art: {card.media.artist}</span>
            )}
            {!pricesLoading && (normalPrice || foilPrice) && (
              <div className="modal-prices">
                {normalPrice && <span className="modal-price-normal">${normalPrice.toFixed(2)}</span>}
                {foilPrice   && <span className="modal-price-foil">✦ ${foilPrice.toFixed(2)}</span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
