// Fill in the derived, read-mostly fields every game config exposes so pages
// can read `game.setLabels[id]` etc. without each game repeating the maps.
export function defineGame(config) {
  const sets = config.sets ?? [];
  return {
    ...config,
    setOrder: sets.map(s => s.id),
    setLabels: Object.fromEntries(sets.map(s => [s.id, s.label])),
    promoSets: new Set(sets.filter(s => s.promo).map(s => s.id)),
    promoFoldSets: new Set(sets.filter(s => s.fold).map(s => s.id)),
    promoShortLabels: Object.fromEntries(sets.filter(s => s.fold).map(s => [s.id, s.short])),
  };
}
