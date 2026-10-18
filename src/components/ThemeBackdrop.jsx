import jinxArt from '../zaun-art/jinx.jpg';
import viArt from '../zaun-art/vi.jpg';
import ekkoArt from '../zaun-art/ekko.jpg';
import viktorArt from '../zaun-art/viktor.jpg';
import jayceArt from '../piltover-art/jayce.jpg';
import caitlynArt from '../piltover-art/caitlyn.jpg';
import heimerdingerArt from '../piltover-art/heimerdinger.jpg';
import viPiltoverArt from '../piltover-art/vi.jpg';
import melArt from '../piltover-art/mel.jpg';
import dariusSplash from '../noxus-art/splash-darius.jpg';
import swainSplash from '../noxus-art/splash-swain.jpg';
import ambessaSplash from '../noxus-art/splash-ambessa.jpg';
import katarinaSplash from '../noxus-art/splash-katarina.jpg';
import dariusCard from '../noxus-art/card-darius.jpg';
import dravenCard from '../noxus-art/card-draven.jpg';
import swainCard from '../noxus-art/card-swain.jpg';
import ambessaCard from '../noxus-art/card-ambessa.jpg';

// Decorative layer behind the app: a faint hextech lattice, a sigil, and the
// active domain's rune art (from --theme-art), all fading out from the top
// right — or, for Piltover, a hextech workshop. Purely visual — no pointer events, hidden from screen readers.

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

// Piltover theme: a hextech workshop — meshing brass and copper gears, a
// hextech core in a riveted housing, floating crystals, a pressure gauge,
// and pipes venting steam. Hidden by every other theme.
function gearPath(teeth, outer, inner, hole) {
  const c = 100;
  const step = (Math.PI * 2) / teeth;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [inner, a], [outer, a + step * 0.12], [outer, a + step * 0.42], [inner, a + step * 0.54],
    ];
    pts.forEach(([r, t], k) => {
      const x = (c + r * Math.cos(t)).toFixed(1);
      const y = (c + r * Math.sin(t)).toFixed(1);
      d += `${i === 0 && k === 0 ? 'M' : 'L'}${x},${y} `;
    });
  }
  // the hole is drawn counter-clockwise so evenodd leaves it empty
  return `${d}Z M${c + hole},${c} A${hole},${hole} 0 1,0 ${c - hole},${c} A${hole},${hole} 0 1,0 ${c + hole},${c} Z`;
}
const GEAR_BIG = gearPath(16, 96, 80, 30);
const GEAR_SMALL = gearPath(10, 96, 76, 34);
const GEAR_COPPER = gearPath(12, 96, 80, 26);
const GEAR_TINY = gearPath(8, 96, 74, 30);
// gauge ticks every 24° across a 240° sweep
const GAUGE_TICKS = Array.from({ length: 11 }, (_, i) => -120 + i * 24);

const HEXGATE_SEGMENTS = Array.from({ length: 12 }, (_, i) => i * 30);

// Riftbound champion art shown in Piltover's Deco arch window, one per 12s.
const PILTOVER_ART = [
  { src: jayceArt, name: 'Jayce', title: 'Man of Progress' },
  { src: caitlynArt, name: 'Caitlyn', title: 'Patrolling' },
  { src: heimerdingerArt, name: 'Heimerdinger', title: 'Inventor' },
  { src: viPiltoverArt, name: 'Vi', title: 'Peacekeeper' },
  { src: melArt, name: 'Mel', title: 'Newly Awakened' },
];

function PiltoverWindow() {
  return (
    <div className="shp p-window">
      <div className="p-window-frame">
        <div className="p-window-glass">
          {PILTOVER_ART.map((a, i) => (
            <figure key={a.name} className="p-slide" style={{ animationDelay: `${i * -12}s` }}>
              <div className="p-slide-img" style={{ backgroundImage: `url("${a.src}")`, animationDelay: `${i * -12}s` }} />
              <figcaption><b>{a.name}</b><span>{a.title}</span></figcaption>
            </figure>
          ))}
          <span className="p-mullions" />
        </div>
      </div>
      <div className="p-plinth"><span /><span /></div>
    </div>
  );
}

export function ThemeShapes({ className = '' }) {
  return (
    <div className={`theme-shapes ${className}`}>
      <PiltoverWindow />
      <svg className="shp shp-gear-big" viewBox="0 0 200 200"><path d={GEAR_BIG} fillRule="evenodd" /></svg>
      <svg className="shp shp-gear-small" viewBox="0 0 200 200"><path d={GEAR_SMALL} fillRule="evenodd" /></svg>
      <svg className="shp shp-hexgate" viewBox="0 0 200 200" fill="none">
        <circle cx="100" cy="100" r="92" strokeWidth="6" />
        <g className="hexgate-ring">
          {HEXGATE_SEGMENTS.map((deg) => (
            <circle key={deg} cx="100" cy="17" r="5" transform={`rotate(${deg} 100 100)`} />
          ))}
        </g>
        <circle cx="100" cy="100" r="54" strokeWidth="14" />
        <polygon className="hexgate-core" points="100,72 124,86 124,114 100,128 76,114 76,86" />
      </svg>
      <svg className="shp shp-crystal shp-crystal-a" viewBox="0 0 60 100">
        <polygon points="30,0 56,30 56,70 30,100 4,70 4,30" />
        <polygon className="facet" points="30,0 56,30 30,44 4,30" />
        <polygon className="facet2" points="30,44 56,30 56,70 30,100" />
      </svg>
      <svg className="shp shp-crystal shp-crystal-b" viewBox="0 0 60 100">
        <polygon points="30,0 56,30 56,70 30,100 4,70 4,30" />
        <polygon className="facet" points="30,0 56,30 30,44 4,30" />
        <polygon className="facet2" points="30,44 56,30 56,70 30,100" />
      </svg>
      <svg className="shp shp-pipes" viewBox="0 0 560 150" fill="none">
        <path className="pipe" d="M-10,122 H404 Q420,122 420,106 V40" />
        <path className="pipe-hi" d="M-10,118 H404 Q416,118 416,106 V40" />
        {[90, 330].map((x) => <rect key={x} className="flange" x={x} y="108" width="14" height="28" rx="2" />)}
        <rect className="flange" x="406" y="70" width="28" height="12" rx="2" />
        <rect className="flange" x="408" y="26" width="24" height="14" rx="3" />
        <g transform="translate(220 122)">
          {/* inner group spins; the outer one positions it (CSS transforms
              would otherwise replace the translate) */}
          <g className="valve">
            <circle r="22" className="valve-rim" />
            {[0, 60, 120].map((d) => <line key={d} x1="-22" y1="0" x2="22" y2="0" transform={`rotate(${d})`} />)}
            <circle r="5" className="valve-hub" />
          </g>
        </g>
      </svg>
      <svg className="shp shp-pipe-right" viewBox="0 0 60 220" fill="none">
        <path className="pipe" d="M30,230 V40" />
        <path className="pipe-hi" d="M26,230 V40" />
        <rect className="flange" x="16" y="120" width="28" height="12" rx="2" />
        <rect className="flange" x="18" y="26" width="24" height="14" rx="3" />
      </svg>
      <div className="p-steam p-steam-left"><i /><i /><i /></div>
      <div className="p-steam p-steam-right"><i /><i /><i /></div>
      <svg className="shp shp-gear-copper" viewBox="0 0 200 200"><path d={GEAR_COPPER} fillRule="evenodd" /></svg>
      <svg className="shp shp-gear-tiny" viewBox="0 0 200 200"><path d={GEAR_TINY} fillRule="evenodd" /></svg>
      <svg className="shp shp-gauge" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="56" className="gauge-rim" />
        <circle cx="60" cy="60" r="47" className="gauge-face" />
        <path className="gauge-red" d="M101.8,46.4 A44,44 0 0,1 98.1,82" />
        {GAUGE_TICKS.map((d) => <line key={d} x1="60" y1="18" x2="60" y2={d % 48 === 0 ? 27 : 24} transform={`rotate(${d} 60 60)`} />)}
        <text x="60" y="86" textAnchor="middle">PSI</text>
        <g className="gauge-needle"><path d="M60,60 L57,62 L60,22 L63,62 Z" /></g>
        <circle cx="60" cy="60" r="6" className="gauge-hub" />
      </svg>
    </div>
  );
}

// Zaun theme: Riftbound champion art (Jinx, Vi, Ekko, Viktor) cross-fading
// through drifting smog, chem bubbles rising, neon fluid running through
// Art Nouveau pipes, and Jinx-style graffiti spraying itself on.
// Hidden by every other theme.
const ZAUN_ART = [jinxArt, viArt, ekkoArt, viktorArt];
// Fixed (not random) so the layout is stable between renders.
const BUBBLES = [
  [4, 7, 14, 0], [9, 4, 11, 3], [15, 9, 17, 7], [22, 5, 12, 1.5], [31, 6, 15, 9], [38, 3, 10, 4],
  [47, 8, 18, 11], [55, 4, 13, 2.5], [63, 6, 16, 6], [70, 3, 11, 12], [77, 7, 14, 5], [84, 5, 12, 8],
  [90, 9, 19, 1], [96, 4, 13, 10],
]; // [left %, size px, duration s, delay s]

function ZaunLayer() {
  return (
    <div className="zaun-layer">
      <div className="z-smog z-smog-a" />
      <div className="z-smog z-smog-b" />
      <div className="z-smog z-smog-c" />
      <div className="z-art">
        {ZAUN_ART.map((src, i) => (
          <div key={src} className="z-art-slide" style={{ backgroundImage: `url("${src}")`, animationDelay: `${i * -12}s` }} />
        ))}
        <div className="z-art-tint" />
      </div>
      <svg className="z-pipes" viewBox="0 0 400 900" preserveAspectRatio="none" fill="none">
        <path className="z-pipe" d="M-10,900 C60,760 20,640 70,520 S150,330 90,190 S40,40 120,-10" />
        <path className="z-flow" d="M-10,900 C60,760 20,640 70,520 S150,330 90,190 S40,40 120,-10" />
        <path className="z-pipe thin" d="M-10,700 C40,640 110,620 130,540 S90,420 160,360" />
        <path className="z-flow thin" d="M-10,700 C40,640 110,620 130,540 S90,420 160,360" />
      </svg>
      <svg className="z-graffiti" viewBox="0 0 300 200" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path className="z-spray pink" pathLength="1" d="M30,40 L80,90 M80,40 L30,90" />
        <path className="z-spray cyan" pathLength="1" d="M110,120 C130,80 170,80 175,110 C180,140 140,150 135,125 C130,100 165,95 170,115" />
        <path className="z-spray pink" pathLength="1" d="M200,60 L215,35 L230,60 L245,35 L260,60 L275,35" />
        <path className="z-spray green" pathLength="1" d="M60,160 C90,140 120,175 150,155 S210,140 240,165" />
      </svg>
      <div className="z-bubbles">
        {BUBBLES.map(([left, size, dur, delay]) => (
          <span key={left} style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `${-delay}s` }} />
        ))}
      </div>
    </div>
  );
}

// Noxus theme: League of Legends splash art (Darius, Swain, Ambessa,
// Katarina) as a panorama under a war-red sky, a swaying war banner of
// Riftbound champions, a fortress line of iron spikes, and rising embers.
// Hidden by every other theme.
const NOXUS_SPLASHES = [dariusSplash, swainSplash, ambessaSplash, katarinaSplash];
const NOXUS_BANNER = [
  { src: dariusCard, name: 'Darius', title: 'Trifarian' },
  { src: dravenCard, name: 'Draven', title: 'Vanquisher' },
  { src: swainCard, name: 'Swain', title: 'Visionary' },
  { src: ambessaCard, name: 'Ambessa', title: 'The Wolf' },
];
// [left %, size px, duration s, delay s]
const EMBERS = [
  [3, 3, 7, 0], [8, 2, 9, 2], [13, 4, 6, 4.5], [19, 2, 8, 1], [26, 3, 10, 6], [33, 2, 7, 3],
  [41, 3, 9, 7.5], [48, 2, 6, 2.5], [56, 4, 8, 5], [63, 2, 10, 0.5], [70, 3, 7, 8], [77, 2, 9, 3.5],
  [84, 4, 6, 6.5], [90, 2, 8, 1.5], [96, 3, 10, 4],
];
// iron fortress spikes: [x, width, height] in a 1200-wide strip
const SPIKES = [
  [20, 40, 70], [80, 26, 120], [130, 34, 90], [190, 22, 150], [240, 40, 80], [310, 28, 110],
  [370, 46, 60], [440, 24, 140], [500, 36, 95], [570, 28, 170], [630, 40, 85], [700, 26, 125],
  [760, 44, 70], [830, 24, 145], [890, 34, 100], [950, 28, 160], [1010, 40, 80], [1080, 26, 130], [1140, 40, 90],
];

function NoxusLayer() {
  return (
    <div className="noxus-layer">
      <div className="n-panorama">
        {NOXUS_SPLASHES.map((src, i) => (
          <div key={src} className="n-pano-slide" style={{ backgroundImage: `url("${src}")`, animationDelay: `${i * -12}s` }} />
        ))}
        <div className="n-pano-tint" />
      </div>
      <svg className="n-spikes" viewBox="0 0 1200 180" preserveAspectRatio="none">
        <rect x="0" y="168" width="1200" height="12" />
        {SPIKES.map(([x, w, h]) => <path key={x} d={`M${x},180 L${x + w / 2},${180 - h} L${x + w},180 Z`} />)}
      </svg>
      <div className="n-banner n-banner-main">
        <div className="n-rod"><i /><i /></div>
        <div className="n-cloth">
          <div className="n-portrait">
            {NOXUS_BANNER.map((a, i) => (
              <figure key={a.name} className="n-slide" style={{ animationDelay: `${i * -12}s` }}>
                <div className="n-slide-img" style={{ backgroundImage: `url("${a.src}")` }} />
                <figcaption><b>{a.name}</b><span>{a.title}</span></figcaption>
              </figure>
            ))}
          </div>
        </div>
      </div>
      <div className="n-banner n-banner-small">
        <div className="n-rod"><i /><i /></div>
        <div className="n-cloth">
          <svg className="n-emblem" viewBox="0 0 100 120" aria-hidden="true">
            <path d="M50,8 L58,48 L50,40 L42,48 Z" />
            <path d="M24,22 L44,56 L34,54 L30,62 Z" />
            <path d="M76,22 L56,56 L66,54 L70,62 Z" />
            <path d="M28,72 L50,64 L72,72 L50,112 Z" />
          </svg>
        </div>
      </div>
      <div className="n-embers">
        {EMBERS.map(([left, size, dur, delay]) => (
          <span key={left} style={{ left: `${left}%`, width: size, height: size, animationDuration: `${dur}s`, animationDelay: `${-delay}s` }} />
        ))}
      </div>
    </div>
  );
}

export default function ThemeBackdrop() {
  return (
    <div className="theme-backdrop" aria-hidden="true">
      <div className="theme-lattice" />
      <div className="theme-art" />
      <ThemeSigil className="theme-sigil" />
      <ThemeShapes />
      <ZaunLayer />
      <NoxusLayer />
    </div>
  );
}
