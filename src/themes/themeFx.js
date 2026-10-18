// Theme effects that CSS can't do alone, for the themes that want them:
//  • pointer parallax — sets --mx/--my (-1..1) on <html>; backdrop layers
//    translate by those times their own depth (see piltover.css / zaun.css)
//  • click bursts — particles pop out of any button you press, styled per
//    theme: Zaun splashes neon chem droplets that arc up and fall. Piltover
//    keeps only the parallax (count: 0).
// Installed only while such a theme is active; skipped entirely when the
// system asks for reduced motion.

const BURSTS = {
  piltover: { count: 0 }, // parallax only — no bursts
  noxus: {
    colors: ['#ff6a2a', '#ffb347', '#d42a3c', '#ffd27a'],
    shapes: [null], // embers
    count: 9,
    glow: true,
    gravity: 30,
  },
  zaun: {
    colors: ['#3df58a', '#b14bff', '#ff3fa4', '#3ee6f0'],
    shapes: [null], // round droplets
    count: 11,
    glow: true,
    gravity: 46,
  },
};

let current = null; // { id, teardown }

function burst(x, y, cfg) {
  const box = document.createElement('div');
  box.className = 'fx-burst';
  box.style.transform = `translate(${x}px, ${y}px)`;
  for (let i = 0; i < cfg.count; i++) {
    const p = document.createElement('i');
    const color = cfg.colors[(i + Math.floor(Math.random() * cfg.colors.length)) % cfg.colors.length];
    const shape = cfg.shapes[i % cfg.shapes.length];
    p.style.background = color;
    if (shape) p.style.clipPath = shape;
    else p.style.borderRadius = '50%';
    if (cfg.glow) p.style.boxShadow = `0 0 8px ${color}, 0 0 2px ${color}`;
    const size = shape ? 10 : 4 + Math.random() * 6;
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    // Fan out, biased upward so droplets can arc over and fall.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * (cfg.glow ? 1.3 : 2);
    const dist = 26 + Math.random() * 34;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    const spin = shape ? (Math.random() - 0.5) * 540 : 0;
    p.animate(
      [
        { transform: 'translate(0, 0) scale(0.4) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(1) rotate(${spin}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.3}px, ${dy + cfg.gravity}px) scale(0.2) rotate(${spin * 1.3}deg)`, opacity: 0 },
      ],
      { duration: 700 + Math.random() * 250, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' },
    );
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 1100);
}

function install(cfg) {
  const root = document.documentElement;
  let frame = 0;
  let px = 0;
  let py = 0;
  const onMove = (e) => {
    px = (e.clientX / window.innerWidth) * 2 - 1;
    py = (e.clientY / window.innerHeight) * 2 - 1;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      root.style.setProperty('--mx', px.toFixed(3));
      root.style.setProperty('--my', py.toFixed(3));
    });
  };
  const onDown = (e) => {
    if (e.button !== 0 || !cfg.count) return;
    const hit = e.target.closest?.('button:not(:disabled), a[href], [role="button"], input[type="checkbox"]');
    if (hit) burst(e.clientX, e.clientY, cfg);
  };
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  return () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onDown);
    cancelAnimationFrame(frame);
    root.style.removeProperty('--mx');
    root.style.removeProperty('--my');
  };
}

// Turn effects on for themes that define them, off for the rest.
export function setThemeFx(themeId) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const cfg = reduce ? null : BURSTS[themeId] ?? null;
  if (current?.id === themeId && cfg) return;
  current?.teardown();
  current = cfg ? { id: themeId, teardown: install(cfg) } : null;
}
