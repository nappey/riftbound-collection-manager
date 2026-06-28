// Pure text helpers for Riftbound card markup (no JSX — kept separate so the
// RiftText component file only exports a component, per react-refresh).

export function decodeEntities(s) {
  return (s ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Split card text into paragraphs at each [Level N] marker, as the layout does.
export function splitRiftParagraphs(plain) {
  return decodeEntities(plain).split(/(?=\[Level \d+\])/).map(s => s.trim()).filter(Boolean);
}
