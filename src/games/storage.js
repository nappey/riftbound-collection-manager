// Per-game localStorage namespaces. Riftbound keeps its original literal keys
// so existing collections keep loading; every other game is prefixed by id.
export const ACTIVE_GAME_KEY = 'card-manager-active-game';

// Device sync (see src/sync/). Not per-game: one sync file covers every game.
export const DEVICE_ID_KEY   = 'card-manager-device-id';
export const SYNC_META_KEY   = 'card-manager-sync-meta';   // { lastSavedAt, lastAppliedAt }
export const SYNC_BACKUP_KEY = 'card-manager-sync-backup'; // local data from before the last sync load
export const THEME_KEY = 'card-manager-theme'; // per-device appearance choice
export const DISPLAY_NAME_KEY = 'card-manager-display-name'; // shown to friends sharing the sync folder
// Discord bot link (see src/discord/). Per device — holds a bearer token, so
// it's deliberately NOT in storageKeys() or the sync snapshot.
export const DISCORD_LINK_KEY = 'card-manager-discord-link';
// Set Entry: how far into each set + domain slice you got, per game and device.
export const entryProgressKey = (gameId) => `card-manager-entry-progress:${gameId}`;
// Set Entry: step-through or grid view, per device.
export const ENTRY_VIEW_KEY = 'card-manager-entry-view';

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
