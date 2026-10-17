// Decorative layer behind the app: a faint hextech lattice, a sigil, and the
// active domain's rune art (from --theme-art), all fading out from the top
// right. Purely visual — no pointer events, hidden from screen readers.

const R = 200; // sigil viewBox radius

function polygon(n, r, rotate = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rotate + (360 / n) * i) * Math.PI) / 180;
    return `${(R + r * Math.cos(a)).toFixed(1)},${(R + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i * 15 * Math.PI) / 180;
  const long = i % 2 === 0;
  const r1 = long ? 176 : 182;
  return [R + r1 * Math.cos(a), R + r1 * Math.sin(a), R + 190 * Math.cos(a), R + 190 * Math.sin(a)];
});

export function ThemeSigil({ className }) {
  return (
    <svg className={className} viewBox={`0 0 ${R * 2} ${R * 2}`} fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx={R} cy={R} r="194" strokeWidth="1.2" />
      <circle cx={R} cy={R} r="170" strokeWidth="0.8" strokeDasharray="2 6" />
      {TICKS.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth="1" />)}
      <polygon points={polygon(6, 160)} strokeWidth="1.2" />
      <polygon points={polygon(3, 132)} strokeWidth="1" />
      <polygon points={polygon(3, 132, 90)} strokeWidth="1" />
      <circle cx={R} cy={R} r="66" strokeWidth="1.2" />
      <polygon points={polygon(4, 40)} strokeWidth="1.4" />
      <circle cx={R} cy={R} r="6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ThemeBackdrop() {
  return (
    <div className="theme-backdrop" aria-hidden="true">
      <div className="theme-lattice" />
      <div className="theme-art" />
      <ThemeSigil className="theme-sigil" />
    </div>
  );
}
