// Curated rune art. riftcodex's rune coverage is incomplete and its set-specific
// arts are inconsistent, so rune printings are driven by local images in
// src/rune-images/, named {Element}-{Printing}.jpg and discovered via Vite glob.
//
// Printings: Origins (standard), Showcase, Spiritforged, Unleashed,
// Nexus (Nexus Night), OPPromo (Organized Play). Drop a correctly-named file
// into src/rune-images/ and it lights up automatically — riftcodex's own
// printings get the art swapped in, and the others are synthesized as cards.

const images = import.meta.glob('../rune-images/*.{jpg,jpeg,png,webp}', {
  eager: true, query: '?url', import: 'default',
});
const RUNE_IMG = {};
for (const [p, url] of Object.entries(images)) {
  RUNE_IMG[p.split('/').pop().replace(/\.[^.]+$/, '')] = url; // "Body-Showcase" → url
}

const RUNES = [
  { el: 'Fury',  domain: 'Fury',  cn: '007', r: 'R01', pids: { Spiritforged: '680274', Unleashed: '692932', OPPromo: '697499' } },
  { el: 'Calm',  domain: 'Calm',  cn: '042', r: 'R02', pids: { Spiritforged: '680304', Unleashed: '692933', OPPromo: '697497' } },
  { el: 'Mind',  domain: 'Mind',  cn: '089', r: 'R03', pids: { Spiritforged: '680331', Unleashed: '692934', OPPromo: '697496' } },
  { el: 'Body',  domain: 'Body',  cn: '126', r: 'R04', pids: { Spiritforged: '680347', Unleashed: '692935', OPPromo: '697495' } },
  { el: 'Chaos', domain: 'Chaos', cn: '166', r: 'R05', pids: { Spiritforged: '680392', Unleashed: '692936', OPPromo: '697493' } },
  { el: 'Order', domain: 'Order', cn: '214', r: 'R06', pids: { Spiritforged: '680432', Unleashed: '692937', OPPromo: '697492' } },
];
const RUNE_BY_NAME = Object.fromEntries(RUNES.map(e => [`${e.el.toLowerCase()} rune`, e]));

// Printings that don't exist as riftcodex cards → synthesized when art is present.
const SYNTH = [
  { printing: 'Spiritforged', setId: 'SFD' },
  { printing: 'Unleashed',    setId: 'UNL' },
  { printing: 'OPPromo',      setId: 'OPR' },
];

function elementOf(card) {
  const base = card.name?.toLowerCase().replace(/\s*\(alternate art\)\s*/i, '').trim();
  return RUNE_BY_NAME[base] ?? null;
}

// Which printing an existing riftcodex rune card represents.
function riftcodexPrinting(card) {
  if (card.set?.set_id === 'OPP') return 'Nexus';
  if (card.metadata?.alternate_art) return 'Showcase';
  return 'Origins';
}

function synthRune(e, printing, setId, url) {
  return {
    id: `rune-${e.el}-${printing}`.toLowerCase(),
    name: `${e.el} Rune`,
    riftbound_id: `${e.r}-${printing}`.toLowerCase(),
    collector_number: parseInt(e.cn, 10),
    tcgplayer_id: e.pids[printing] ?? null,
    classification: { type: 'Rune', supertype: null, rarity: 'showcase', domain: [e.domain] },
    attributes: {},
    set: { set_id: setId, label: printing },
    media: { image_url: url },
    metadata: { alternate_art: false, clean_name: `${e.el} Rune` },
    text: { plain: '', flavour: '' },
    tags: [],
    _synthetic: true,
  };
}

/**
 * Swap local art onto riftcodex's rune printings and append the synthesized
 * printings (Spiritforged / Unleashed / OP Promo) whose art is present.
 */
export function augmentRunes(cards) {
  const out = cards.map(card => {
    if (card.classification?.type !== 'Rune') return card;
    const e = elementOf(card);
    if (!e) return card;
    const url = RUNE_IMG[`${e.el}-${riftcodexPrinting(card)}`];
    return url ? { ...card, media: { ...card.media, image_url: url } } : card;
  });

  for (const e of RUNES) {
    for (const { printing, setId } of SYNTH) {
      const url = RUNE_IMG[`${e.el}-${printing}`];
      if (!url) continue; // only show printings whose art has been provided
      out.push(synthRune(e, printing, setId, url));
    }
  }
  return out;
}
