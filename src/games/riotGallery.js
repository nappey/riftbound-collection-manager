// Riftbound's main card source: Riot's official card gallery
// (playriftbound.com), which has each set on launch day. Its card list is
// embedded in the page's __NEXT_DATA__ JSON, so we fetch the HTML and convert
// each card into the riftcodex-like shape the rest of the app reads. Promo sets
// aren't in the gallery and still come from riftcodex — see riftbound.js.
//
// Converted cards use their riftbound_id ("rad-038-167") as their id.

const GALLERY_PATH = '/en-us/card-gallery/';

const val = (f) => f?.value?.id ?? null;
const stripTags = (html) => (html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();
// "unl-116a-219" / "rad-r02a" — a letter right after the number marks an alt art.
const ALT_RE = /^[a-z0-9]+-[a-z]*\d+[a-z]-?/;

// Riot spells signature variants "unl-229-star-219"; riftcodex and CSV
// exports use "unl-229*-219".
const normalizeId = (id) => id.replace('-star-', '*-');

function toRiftcodexShape(raw) {
  const c = { ...raw, id: normalizeId(raw.id) };
  const type = c.cardType?.type?.[0]?.label ?? null;
  const supertype = c.cardType?.superType?.[0]?.label ?? null;
  const total = Number(c.id.split('-').pop());
  const alt = ALT_RE.test(c.id);
  const over = Number.isFinite(total) && c.collectorNumber > total;
  const tags = c.tags?.tags ?? [];
  const subtitle = c.subtitle?.trim();
  // riftcodex names cards "Name - Subtitle"; Riot titles legends by epithet
  // alone ("Agony's Embrace") with the champion only in tags.
  let name = c.name;
  if (subtitle) name = `${c.name} - ${subtitle}`;
  else if (type === 'Legend' && tags[0]) name = `${tags[0]} - ${c.name}`;
  const sigVariant = c.id.includes('*');
  // "rad-sp1-005": Radiance's K/DA Special Art showcases share their base
  // champion's name — label them so they don't read as duplicates.
  const specialArt = /^[a-z0-9]+-sp\d+-/.test(c.id);
  if (sigVariant) name += ' (Signature)';
  else if (specialArt) name += ' (Special Art)';
  else if (alt) name += ' (Alternate Art)';
  else if (over) name += ' (Overnumbered)';
  const rich = c.text?.richText?.body ?? '';

  return {
    id: c.id,
    name,
    riftbound_id: c.id,
    tcgplayer_id: null, // filled from tcgcsv by enrichFromTcg
    collector_number: c.collectorNumber,
    // riftcodex leaves might null on gear that grants a Might bonus
    attributes: { energy: val(c.energy), might: c.mightBonus ? null : val(c.might), power: val(c.power) },
    classification: {
      type,
      supertype,
      rarity: c.rarity?.value?.label ?? null,
      domain: (c.domain?.values ?? []).map((d) => d.label),
    },
    text: { rich, plain: stripTags(rich), flavour: '' },
    set: { set_id: c.set?.value?.id, label: c.set?.value?.label },
    media: {
      image_url: c.cardImage?.url ?? null,
      artist: (c.illustrator?.values ?? []).map((v) => v.label).join(', '),
      accessibility_text: c.cardImage?.accessibilityText ?? '',
    },
    tags,
    orientation: c.orientation,
    metadata: {
      clean_name: name.replace(/[^\w\s']/g, ' ').replace(/\s+/g, ' ').trim(),
      alternate_art: alt,
      overnumbered: over,
      signature: sigVariant || supertype === 'Signature',
      special_art: specialArt,
    },
    _source: 'riot',
  };
}

// The card array sits a few levels into the page props; find it by shape
// rather than by path so a page-layout change doesn't break us.
function findCardArray(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node) && node.length > 50 && node[0]?.set?.value?.id && node[0]?.cardImage) return node;
  for (const k in node) {
    const found = findCardArray(node[k]);
    if (found) return found;
  }
  return null;
}

// Tokens with no card type (Baron Pit, XP Tracker…) are game aids rather
// than collectible cards; typed tokens (Recruit, Sprite, Gold) are kept.
const isCollectible = (c) => c.cardType?.type?.length || !c.cardType?.superType?.some((s) => s.id === 'token');

/**
 * Fetch the gallery and return riftcodex-shaped cards for every set except
 * those in `exclude`.
 * @param {string} riotBase  e.g. https://playriftbound.com (Electron) or /riot (browser proxy)
 * @param {Set<string>} exclude
 */
export async function fetchRiotCards(riotBase, exclude = new Set(), { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${riotBase}${GALLERY_PATH}`, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) throw new Error(`Riot gallery ${res.status}`);
    const html = await res.text();
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) throw new Error('Riot gallery: no __NEXT_DATA__');
    const raw = findCardArray(JSON.parse(m[1])) ?? [];
    return raw.filter((c) => !exclude.has(c.set?.value?.id) && isCollectible(c)).map(toRiftcodexShape);
  } finally {
    clearTimeout(timer);
  }
}

// ── tcgcsv enrichment ──────────────────────────────────────────

// "rad-061a-167" → "061A/167", "rad-sp1-005" → "SP1/005", "rad-r02" → "R02".
// Matches tcgcsv's extendedData "Number" (uppercased).
function tcgNumber(card) {
  const rest = card.riftbound_id.slice(card.set.set_id.length + 1);
  const i = rest.lastIndexOf('-');
  return (i > 0 ? `${rest.slice(0, i)}/${rest.slice(i + 1)}` : rest).toUpperCase();
}

const ext = (p, name) => p.extendedData?.find((e) => e.name === name)?.value ?? null;

const DOMAINS = new Set(['Fury', 'Calm', 'Mind', 'Body', 'Chaos', 'Order']);
// Sets whose gallery domains are unreliable, so tcgcsv's win. Radiance launched
// with ~25 cards in the wrong domain (Bilgewater Tracker, #003 in the Fury
// block, tagged Body) and a dozen with none. For older sets the gallery is the
// better source — tcgcsv has its own handful of wrong domains there.
const TCG_DOMAIN_SETS = new Set(['RAD']);

// "Fury;Chaos" → ['Fury', 'Chaos']; null for "None" (battlefields) or missing.
function tcgDomains(p) {
  const parts = (ext(p, 'Domain') ?? '').split(';').map((s) => s.trim()).filter(Boolean);
  return parts.length && parts.every((d) => DOMAINS.has(d)) ? parts : null;
}

// "rad-062a-167" / "rad-062*-167" → "rad-062-167".
const baseRid = (rid) => rid.replace(/^([a-z0-9]+-[a-z]*\d+)[a-z*]?(?=-)/, '$1');

/**
 * Main sets are numbered in domain blocks (Fury, Calm, Mind…). A card with one
 * domain — or none — that differs from both its numbered neighbours, which
 * agree with each other, is mis-tagged at the source: Radiance's Gravity Field
 * (#062, Mind) and Demon Shade (#102, Chaos) are wrong in both the gallery and
 * tcgcsv, and #009 / #041 / #121 have no domain in either. Such a card takes
 * its neighbours' domain, and so do its alt arts and signature versions.
 */
export function fixDomainOutliers(cards) {
  const byNumber = new Map(); // `${set}|${n}` → base print
  for (const c of cards) {
    // Numbered main-set prints only ("rad-062-167"), not tokens/runes ("sfd-t03").
    if (/^[a-z0-9]+-\d+-\d+$/.test(c.riftbound_id) && !c.metadata.overnumbered) {
      byNumber.set(`${c.set.set_id}|${c.collector_number}`, c);
    }
  }
  const single = (c) => (c?.classification.domain.length === 1 ? c.classification.domain[0] : null);
  const fixed = new Map(); // base riftbound_id → domain
  for (const c of byNumber.values()) {
    const ds = c.classification.domain;
    if (ds.length > 1) continue; // dual-domain cards are deliberate
    const prev = single(byNumber.get(`${c.set.set_id}|${c.collector_number - 1}`));
    const next = single(byNumber.get(`${c.set.set_id}|${c.collector_number + 1}`));
    if (prev && prev === next && prev !== ds[0] && DOMAINS.has(prev)) fixed.set(c.riftbound_id, prev);
  }
  if (!fixed.size) return cards;
  return cards.map((c) => {
    const domain = fixed.get(baseRid(c.riftbound_id));
    return domain ? { ...c, classification: { ...c.classification, domain: [domain] } } : c;
  });
}

/**
 * Attach tcgplayer_id (so prices resolve), plus card type and flavour text
 * where the gallery is missing them, from the set's tcgcsv products.
 * Best-effort: on any failure the cards come back unchanged.
 */
export async function enrichFromTcg(cards, tcgcsvBase) {
  if (!cards.length) return cards;
  try {
    const groups = await fetch(`${tcgcsvBase}/groups`).then((r) => r.json());
    const groupBySet = new Map((groups.results ?? []).map((g) => [g.abbreviation, g.groupId]));
    const setIds = [...new Set(cards.map((c) => c.set.set_id))].filter((s) => groupBySet.has(s));
    const productLists = await Promise.all(setIds.map((s) =>
      fetch(`${tcgcsvBase}/${groupBySet.get(s)}/products`).then((r) => r.json()).then((d) => [s, d.results ?? []])));

    const byKey = new Map(); // `${set}|${number}` → product, or null when ambiguous
    for (const [s, products] of productLists) {
      for (const p of products) {
        const num = ext(p, 'Number');
        if (!num) continue; // sealed product
        const key = `${s}|${num.toUpperCase()}`;
        byKey.set(key, byKey.has(key) ? null : p);
      }
    }

    return cards.map((card) => {
      const p = byKey.get(`${card.set.set_id}|${tcgNumber(card)}`);
      if (!p) return card;
      const next = { ...card, tcgplayer_id: String(p.productId) };
      if (!card.classification.type) {
        // "Champion Unit" / "Signature Spell" / "Gear"
        const words = (ext(p, 'Card Type') ?? '').split(' ');
        const type = words.pop() || null;
        next.classification = { ...card.classification, type, supertype: card.classification.supertype ?? (words[0] || null) };
      }
      const domain = tcgDomains(p);
      if (domain && (!card.classification.domain.length || TCG_DOMAIN_SETS.has(card.set.set_id))) {
        next.classification = { ...next.classification, domain };
      }
      const flavour = stripTags(ext(p, 'Flavor Text'));
      if (flavour) next.text = { ...card.text, flavour };
      return next;
    });
  } catch (e) {
    console.warn('[riot] tcgcsv enrichment failed:', e?.message ?? e);
    return cards;
  }
}
