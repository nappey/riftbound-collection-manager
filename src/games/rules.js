// Per-card rule dispatch. Card-only helpers in utils/ (playset, analysis,
// printings) call these so they work for any game without a `game` prop being
// threaded through every component. Riftbound cards carry no `game` field, so
// they keep resolving to the Riftbound rules unchanged.
import * as riftbound from './riftboundRules';
import * as cyberpunk from './cyberpunkRules';

const RULES = { riftbound, cyberpunk };

export function rulesFor(card) {
  return RULES[card?.game] ?? riftbound;
}
