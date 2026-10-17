import { useLayoutEffect, useRef } from 'react';

// A row of tabs with one highlight ("glider") that slides to the active tab.
// The glider is positioned by writing to its style directly — no re-render —
// and only starts animating after its first placement, so it doesn't sweep
// in from the left on mount.
//
// items: [{ id, label, icon?, badge? }]
export default function SlidingTabs({ items, active, onSelect, className = '', ariaLabel }) {
  const rowRef = useRef(null);
  const gliderRef = useRef(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const glider = gliderRef.current;
    if (!row || !glider) return;
    const place = () => {
      const el = row.querySelector('[data-active="true"]');
      if (!el) { glider.style.opacity = '0'; return; }
      glider.style.opacity = '1';
      glider.style.width = `${el.offsetWidth}px`;
      glider.style.transform = `translateX(${el.offsetLeft}px)`;
      if (!glider.dataset.ready) requestAnimationFrame(() => { glider.dataset.ready = 'true'; });
    };
    place();
    // Labels/badges change width (e.g. the card count), and fonts load late.
    const ro = new ResizeObserver(place);
    ro.observe(row);
    row.querySelectorAll('button').forEach((b) => ro.observe(b));
    return () => ro.disconnect();
  }, [active, items]);

  return (
    <nav ref={rowRef} className={`sliding-tabs ${className}`} aria-label={ariaLabel}>
      <span ref={gliderRef} className="sliding-tabs-glider" aria-hidden="true" />
      {items.map((it) => {
        const on = it.id === active;
        return (
          <button
            key={it.id}
            type="button"
            className="sliding-tab"
            data-active={on}
            aria-current={on ? 'page' : undefined}
            onClick={() => onSelect(it.id)}
          >
            {it.icon}
            <span className="sliding-tab-label">{it.label}</span>
            {it.badge != null && <span className="sliding-tab-badge">{it.badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
