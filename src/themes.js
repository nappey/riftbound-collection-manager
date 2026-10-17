import { THEME_KEY } from './games/storage';
import furyArt from './rune-images/Fury-Showcase.jpg';
import calmArt from './rune-images/Calm-Showcase.jpg';
import mindArt from './rune-images/Mind-Showcase.jpg';
import bodyArt from './rune-images/Body-Showcase.jpg';
import chaosArt from './rune-images/Chaos-Showcase.jpg';
import orderArt from './rune-images/Order-Showcase.jpg';

// App themes, all drawn from Riftbound: the original Rift violet plus one per
// domain. Colors live in index.css under [data-theme="<id>"]; `art` is that
// domain's rune, shown faded behind the header (see <ThemeBackdrop/>).
export const THEMES = [
  { id: 'rift',  name: 'Rift',  blurb: 'The original violet',       art: null },
  { id: 'fury',  name: 'Fury',  blurb: 'Red · aggression & fire',   art: furyArt },
  { id: 'calm',  name: 'Calm',  blurb: 'Green · patience & nature', art: calmArt },
  { id: 'mind',  name: 'Mind',  blurb: 'Blue · cunning & arcana',   art: mindArt },
  { id: 'body',  name: 'Body',  blurb: 'Orange · strength & will',  art: bodyArt },
  { id: 'chaos', name: 'Chaos', blurb: 'Purple · trickery & void',  art: chaosArt },
  { id: 'order', name: 'Order', blurb: 'Gold · law & radiance',     art: orderArt },
];

const DEFAULT_THEME = 'rift';
export const getTheme = (id) => THEMES.find((t) => t.id === id) ?? THEMES[0];

export function loadThemeId() {
  try { return getTheme(localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME).id; }
  catch { return DEFAULT_THEME; }
}

// Sets the theme on <html> so every token in index.css follows it.
export function applyTheme(id) {
  const theme = getTheme(id);
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  if (theme.art) root.style.setProperty('--theme-art', `url("${theme.art}")`);
  else root.style.removeProperty('--theme-art');
  try { localStorage.setItem(THEME_KEY, theme.id); } catch { /* ignore */ }
}
