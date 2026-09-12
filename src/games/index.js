import riftbound from './riftbound';
import cyberpunk from './cyberpunk';

export const GAMES = { riftbound, cyberpunk };
export const GAME_IDS = Object.keys(GAMES);
export const DEFAULT_GAME = 'riftbound';

export function getGame(id) {
  return GAMES[id] ?? GAMES[DEFAULT_GAME];
}
