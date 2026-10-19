import { useSyncExternalStore } from 'react';

// Phone-sized screens get the mobile layout (bottom tab bar, filter sheet,
// stats strip). Keep in sync with the breakpoint in src/mobile.css.
export const MOBILE_QUERY = '(max-width: 720px)';

function subscribe(cb) {
  const mq = window.matchMedia(MOBILE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useIsMobile() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
