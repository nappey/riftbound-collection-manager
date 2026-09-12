// Per-game localStorage namespaces. Riftbound keeps its original literal keys
// so existing collections keep loading; every other game is prefixed by id.
export const ACTIVE_GAME_KEY = 'card-manager-active-game';

export function storageKeys(gameId) {
  const p = gameId; // 'riftbound' → the legacy keys below, byte-for-byte
  return {
    collection: `${p}-collection`,
    foil:       `${p}-collection-foil`,
    lf:         `${p}-looking-for`,
    uft:        `${p}-up-for-trade`,
    decks:      `${p}-decks`,
    merchant:   `${p}-merchant`,
    vendor:     `${p}-merchant-vendor`,
  };
}
