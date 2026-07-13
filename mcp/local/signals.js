// Extracted signal shape: { type: 'css_class' | 'css_id' | 'data_attr' | 'asset_url' | 'text', value: string }
// Used later ONLY as literal substring/regex-escaped matches — never as a
// path component, shell argument, or unescaped regex (spec.md NFR-04:
// remote/scan-derived text is inert data, this is where that boundary is
// enforced by construction: this function only extracts, never executes).
const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'your']);

export function extractSignals(finding) {
  const signals = [];
  const snippet = finding?.html_snippet ?? '';
  if (typeof snippet !== 'string' || snippet.length === 0) return signals;

  for (const m of snippet.matchAll(/class=["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/).filter(Boolean)) {
      signals.push({ type: 'css_class', value: cls });
    }
  }

  for (const m of snippet.matchAll(/\bid=["']([^"']+)["']/g)) {
    signals.push({ type: 'css_id', value: m[1] });
  }

  for (const m of snippet.matchAll(/\b(data-[a-z0-9-]+)=["']([^"']*)["']/gi)) {
    signals.push({ type: 'data_attr', value: `${m[1]}=${m[2]}` });
  }

  for (const m of snippet.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/gi)) {
    signals.push({ type: 'asset_url', value: m[1] });
  }

  const textOnly = snippet.replace(/<[^>]+>/g, ' ').trim();
  for (const run of textOnly.split(/\s{2,}|\n/).map((s) => s.trim()).filter(Boolean)) {
    const words = run.split(/\s+/);
    const meaningfulWords = words.filter((w) => !STOPWORDS.has(w.toLowerCase()) && w.length > 2);
    if (run.length >= 12 && meaningfulWords.length >= 2) {
      signals.push({ type: 'text', value: run });
    }
  }

  return signals;
}
