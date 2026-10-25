// Same name within the same set — so in the All sets view an alt never lands
// on a reprint from another set.
const nameKey = (card) => `${card.set?.set_id}|${(card.metadata?.clean_name ?? card.name)
  .toLowerCase()
  .replace(/\s*alternate\s*art\s*/gi, '')
  .trim()}`;

// "rad-109a-167" → "rad-109-167": the base print an alt art belongs to.
export const baseIdOf = (id) => id?.replace(/^([a-z0-9]+-[a-z]*\d+)[a-z](?=-|$)/, '$1');

// Each alt attaches to exactly one base — the print it was drawn from (by id),
// else the first base in its set with the same name. Two bases can share a name (Radiance
// "Evelynn - In Control" is both #109 and the special print SP3), and attaching
// the alt to both renders it twice under one React key.
export function groupWithAlts(cards) {
  const alts = [];
  const groups = [];
  const byId = new Map();
  const byName = new Map();

  for (const card of cards) {
    if (card.metadata?.alternate_art) { alts.push(card); continue; }
    const group = { base: card, alts: [] };
    groups.push(group);
    byId.set(card.id, group);
    const key = nameKey(card);
    if (!byName.has(key)) byName.set(key, group);
  }

  for (const alt of alts) {
    const group = byId.get(baseIdOf(alt.id)) ?? byName.get(nameKey(alt));
    if (group) group.alts.push(alt);
    else groups.push({ base: alt, alts: [] });
  }

  return groups;
}
