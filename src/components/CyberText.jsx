// Renders Cyberpunk TCG card text: ability-word tokens like {Play}, {Call},
// {Go Solo} become colored pills, UPPERCASE tag references (ARASAKA, BRAINDANCE)
// become keyword pills, and parenthesised reminder text is dimmed.
import { symbolFor } from '../utils/cyberText';

const TOKEN = /\{([^}]+)\}|\(([^()]*)\)|\b([A-Z][A-Z'’-]{2,}(?:\s[A-Z][A-Z'’-]{2,})*)\b/g;

export default function CyberText({ text }) {
  const out = [];
  let last = 0, i = 0;
  for (const m of String(text ?? '').matchAll(TOKEN)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] != null) {
      const sym = symbolFor(m[1]);
      out.push(<span key={i++} className="cp-sym" style={{ '--c': sym.color }}>{sym.name}</span>);
    } else if (m[2] != null) {
      out.push(<i key={i++} className="cp-reminder">({m[2]})</i>);
    } else {
      out.push(<span key={i++} className="rb-kw">{m[3]}</span>);
    }
    last = m.index + m[0].length;
  }
  if (last < (text ?? '').length) out.push(text.slice(last));
  return <>{out}</>;
}
