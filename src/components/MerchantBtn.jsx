// "Send to Merchant" button for card tiles/rows: consigns one copy to the
// Traveling Merchant page. Prefers a normal copy; falls back to a foil when
// that's all you own (always-foil cards only ever have foils). Disabled when
// you own none, since consigning moves the copy out of your collection.
export default function MerchantBtn({ count = 0, foilCount = 0, onConsign, compact = false }) {
  const canNormal = count > 0;
  const canFoil = foilCount > 0;
  const disabled = !canNormal && !canFoil;
  const title = disabled
    ? 'Own a copy to send it to the Merchant'
    : canNormal ? 'Send a copy to the Traveling Merchant' : 'Send a foil copy to the Traveling Merchant';
  return (
    <button
      className={`tag-btn merchant${compact ? ' compact' : ''}`}
      disabled={disabled}
      title={title}
      onClick={() => onConsign?.(!canNormal)}
      aria-label="Send to merchant"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 10l1.5-5h15L21 10"/><path d="M4 10v10h16V10"/><path d="M3 10h18"/><path d="M9 20v-6h6v6"/>
      </svg>
      {!compact && <span>SELL</span>}
    </button>
  );
}
