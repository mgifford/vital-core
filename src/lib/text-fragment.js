/**
 * Native text-fragment links (`#:~:text=`) for recorded elements that have a
 * bounded visible text anchor. No JavaScript is involved: the browser scrolls
 * to and highlights the matching text. It highlights text, not an element box,
 * and may choose the first occurrence; the report must say so.
 */
export function textFragmentUrl(bug) {
  if (!bug || typeof bug.url !== 'string' || !/^https?:\/\//i.test(bug.url)) return null;
  const text = typeof bug.element?.text_anchor === 'string' ? bug.element.text_anchor.trim() : '';
  if (text.length < 3) return null;
  let url;
  try { url = new URL(bug.url); } catch (error) { return null; }
  // A text directive must own the fragment; do not overwrite hash-routing state.
  if (url.hash) return null;
  const encoded = encodeURIComponent(text)
    .replace(/,/g, '%2C')
    .replace(/-/g, '%2D');
  url.hash = `:~:text=${encoded}`;
  return url.href;
}
