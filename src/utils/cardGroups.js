export function groupWithAlts(cards) {
  const altsByBase = {};
  const bases = [];

  for (const card of cards) {
    if (card.metadata?.alternate_art) {
      const baseKey = (card.metadata.clean_name ?? card.name)
        .toLowerCase()
        .replace(/\s*alternate\s*art\s*/gi, '')
        .trim();
      (altsByBase[baseKey] = altsByBase[baseKey] || []).push(card);
    } else {
      bases.push(card);
    }
  }

  const matchedAltIds = new Set();
  const groups = bases.map((base) => {
    const key = (base.metadata?.clean_name ?? base.name).toLowerCase().trim();
    const alts = altsByBase[key] ?? [];
    alts.forEach((a) => matchedAltIds.add(a.id));
    return { base, alts };
  });

  for (const alts of Object.values(altsByBase)) {
    for (const alt of alts) {
      if (!matchedAltIds.has(alt.id)) groups.push({ base: alt, alts: [] });
    }
  }

  return groups;
}
