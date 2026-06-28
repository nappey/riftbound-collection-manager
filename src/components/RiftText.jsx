// Renders Riftbound card text, replacing the raw RiftScribe markup tokens with
// inline icons and styled keyword pills:
//   :rb_energy_N:   → energy cost badge (N)
//   :rb_power_N:    → power symbol (optional number)
//   :rb_might:      → might symbol
//   :rb_exhaust:    → exhaust / tap symbol
//   :rb_rune_X:     → domain rune pip (X = body/calm/chaos/fury/mind/order/colorless)
//   [Keyword]       → keyword pill (e.g. [Ganking], [Accelerate], [Assault 2])
//   [>]             → arrow

import { decodeEntities } from '../utils/riftText';

const DOMAINS = new Set(['body', 'calm', 'chaos', 'fury', 'mind', 'order', 'colorless']);

// 24×24 glyphs, drawn with currentColor so they inherit the badge color.
const GLYPH = {
  // four-point impact star — Might
  might: <path d="M12 2l2.3 6.9L21 11l-6.7 2.1L12 20l-2.3-6.9L3 11l6.7-2.1z" />,
  // lightning bolt — Power
  power: <path d="M13 2L4 14h5l-1 8 9-12h-5z" />,
  // circular tap arrow — Exhaust
  exhaust: <path d="M12 4V1L7.5 5.5 12 10V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />,
};

function SymIcon({ kind, n }) {
  return (
    <span className={`rb-ico rb-${kind}`} title={kind[0].toUpperCase() + kind.slice(1)}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{GLYPH[kind]}</svg>
      {n != null && <span className="rb-ico-n">{n}</span>}
    </span>
  );
}

function EnergyIcon({ n }) {
  return <span className="rb-ico rb-energy" title="Energy">{n}</span>;
}

function RuneIcon({ domain }) {
  const d = domain.toLowerCase();
  const known = DOMAINS.has(d);
  const color = known ? `var(--d-${d})` : 'var(--text-2)';
  return (
    <span className="rb-ico rb-rune" title={`${d[0].toUpperCase() + d.slice(1)} rune`}
      style={{ color }}>
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2l10 10-10 10L2 12z" />
      </svg>
    </span>
  );
}

function Keyword({ label }) {
  return <span className="rb-kw">{label}</span>;
}

const TOKEN = /(:rb_energy_(\d+):)|(:rb_power(?:_(\d+))?:)|(:rb_might:)|(:rb_exhaust:)|(:rb_rune_([a-z]+):)|(:rb_([a-z0-9_]+):)|(\[([^\]]+)\])/gi;

function parseRift(text) {
  const nodes = [];
  let last = 0, m, key = 0;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[2] != null) nodes.push(<EnergyIcon key={key++} n={m[2]} />);
    else if (m[3] != null) nodes.push(<SymIcon key={key++} kind="power" n={m[4]} />);
    else if (m[5] != null) nodes.push(<SymIcon key={key++} kind="might" />);
    else if (m[6] != null) nodes.push(<SymIcon key={key++} kind="exhaust" />);
    else if (m[7] != null) nodes.push(<RuneIcon key={key++} domain={m[8]} />);
    else if (m[9] != null) nodes.push(<span key={key++} className="rb-ico rb-generic">{m[10].replace(/_/g, ' ')}</span>);
    else if (m[11] != null) {
      const inner = m[12].trim();
      if (inner === '>' || inner === '→') nodes.push(<span key={key++} className="rb-arrow">→</span>);
      else nodes.push(<Keyword key={key++} label={inner} />);
    }
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function RiftText({ text }) {
  return <>{parseRift(decodeEntities(text))}</>;
}
