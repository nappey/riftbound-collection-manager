import { createContext, useContext } from 'react';

// The active game's config (see games/index.js). Provided once by App so any
// page or component can read labels, set lists and rules without prop drilling.
export const GameContext = createContext(null);

export function useGame() {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame() called outside <GameContext.Provider>');
  return game;
}
