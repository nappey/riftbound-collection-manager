// Cyberpunk TCG card data from the Netdeck.gg API (the same backend that
// powers cyberpunktcg.com/cards). Public, no auth.
//
//   GET {base}/cyberpunk?limit=100&offset=N   → { items, total }   (one printing per card)
//   GET {base}/cyberpunk/{slug}               → card + printings[]  (every printing)
//
// The list endpoint only carries each card's default printing, so every card
// is fetched once more by slug to expand Beta / alt-art / Iconic / promo
// printings. Each printing becomes its own card (own id) so the collection can
// track them separately, exactly like Riftbound's alt arts.

import { SETS } from './cyberpunkRules';

const SET_SHORT = Object.fromEntries(SETS.map(s => [s.id, s.short]));
const PAGE = 100;
const CONCURRENCY = 8;

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Netdeck ${r.status} for ${url}`);
  return r.json();
}

async function fetchList(base) {
  const items = [];
  let total = Infinity;
  for (let offset = 0; offset < total; offset += PAGE) {
    const page = await getJSON(`${base}/cyberpunk?limit=${PAGE}&offset=${offset}`);
    items.push(...(page.items ?? []));
    total = page.total ?? items.length;
    if (!page.items?.length) break;
  }
  return items;
}

// Worker pool over the detail endpoint. A single failed slug falls back to the
// list item (its default printing) rather than failing the whole load.
async function fetchDetails(base, items, onProgress) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      const item = items[i];
      try {
        out[i] = await getJSON(`${base}/cyberpunk/${encodeURIComponent(item.slug)}`);
      } catch {
        out[i] = item;
      }
      done++;
      onProgress?.(done, items.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return out;
}

// "β005a" → { number: 5, variant: 'a', beta: true }
function parseCollector(label) {
  const s = String(label ?? '');
  const beta = s.startsWith('β') || /^b\d/i.test(s);
  const m = s.replace(/^β/, '').match(/(\d+)\s*([a-z])?$/i);
  return {
    number: m ? parseInt(m[1], 10) : 0,
    variant: m?.[2]?.toLowerCase() ?? null,
    beta,
  };
}

// Normalize one Netdeck printing into the app's card shape.
function normalizePrinting(card, p) {
  const { number, variant } = parseCollector(p.collector_number);
  const name = card.display_name ?? (card.subname ? `${card.name}: ${card.subname}` : card.name);
  return {
    game: 'cyberpunk',
    id: p.id,
    name,
    base_name: card.name,
    subname: card.subname ?? null,
    riftbound_id: null,
    tcgplayer_id: null,
    collector_number: number,
    collector_label: p.collector_number,
    // Short human id shown where Riftbound shows its riftbound_id ("WNC 005a").
    code: `${SET_SHORT[p.set?.code] ?? p.set?.code ?? ''} ${p.collector_number ?? ''}`.trim(),
    set: { set_id: p.set?.code ?? card.set?.code ?? 'UNKNOWN', label: p.set?.name ?? card.set?.name ?? '' },
    classification: {
      type: card.card_type,
      supertype: null,
      rarity: p.rarity ?? card.rarity ?? '',
      domain: card.color ? [card.color] : [],
    },
    attributes: { energy: card.cost ?? null, power: card.power ?? null, ram: card.ram ?? null },
    media: { image_url: p.image_url ?? p.source_image_url ?? null, artist: p.artist ?? card.artist ?? null, fallback_image_url: null },
    metadata: {
      alternate_art: variant === 'b',
      clean_name: name,
      identity: card.id,
      variant,
      slug: card.slug,
      external_id: card.external_id,
    },
    text: { plain: card.rules_text ?? '', flavour: card.flavor_text ?? '' },
    tags: [...(card.classifications ?? []), ...(card.keywords ?? [])],
    is_eddiable: !!card.is_eddiable,
    legality: card.legality ?? null,
  };
}

function normalize(detail) {
  const printings = detail.printings?.length
    ? detail.printings
    : [{
        id: detail.printing_id ?? detail.id,
        collector_number: detail.print_number,
        image_url: detail.image_url,
        source_image_url: detail.source_image_url,
        set: detail.set,
        rarity: detail.rarity,
        artist: detail.artist,
      }];
  return printings.map(p => normalizePrinting(detail, p));
}

/**
 * Load every Cyberpunk printing as a normalized card.
 * @param {{ netdeckBase: string }} env
 * @param {(done:number, total:number) => void} [onProgress]
 */
export async function loadCards({ netdeckBase }, onProgress) {
  const items = await fetchList(netdeckBase);
  onProgress?.(0, items.length);
  const details = await fetchDetails(netdeckBase, items, onProgress);
  const cards = details.flatMap(normalize);
  // Netdeck occasionally lists the same printing under two cards — keep the first.
  const seen = new Set();
  return cards.filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
