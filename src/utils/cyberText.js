// Pure text helpers for Cyberpunk TCG card markup (no JSX — the CyberText
// component file only exports a component, per react-refresh).

// Ability-word symbols, as served by Netdeck's symbol manifest. Colors are the
// manifest's; text pills stand in for the SVG glyphs so this works offline.
export const SYMBOLS = {
  'play':       { name: 'Play',       color: '#fcee17' },
  'go solo':    { name: 'Go Solo',    color: '#fcee17' },
  'adrenaline': { name: 'Adrenaline', color: '#fcee17' },
  'call':       { name: 'Call',       color: '#fcee17' },
  'attack':     { name: 'Attack',     color: '#33a94c' },
  'blocker':    { name: 'Blocker',    color: '#ed3193' },
  'quick':      { name: 'Quick',      color: '#ed3193' },
  'defeated':   { name: 'Defeated',   color: '#ed1c2a' },
  'star':       { name: '★',          color: '#fcee17' },
  'spend':      { name: 'Spend',      color: '#9aa4b2' },
  'spend icon': { name: 'Spend',      color: '#9aa4b2' },
};

export function symbolFor(token) {
  const key = token.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return SYMBOLS[key] ?? SYMBOLS[key.replace(/ (icon|outline|filled)$/g, '')] ?? { name: token, color: '#9aa4b2' };
}

// One paragraph per line of rules text.
export function splitCyberParagraphs(text) {
  return String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
