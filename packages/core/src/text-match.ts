/** Lightweight relevance scoring with partial matching and typo tolerance (used by the in-memory store). */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t.length > 0);
}

export function levenshtein(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = tmp;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > max) return max + 1;
  }
  return prev[b.length];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'near', 'nearby', 'me', 'my', 'find', 'show', 'in', 'at', 'and', 'with', 'within', 'where', 'can', 'i', 'buy', 'get', 'store', 'stores', 'shop', 'shops', 'this', 'product', 'item']);

/** Everyday shopper words → catalog vocabulary (extend from zero-result search reports). */
export const SYNONYMS: Record<string, string> = {
  bottled: '', soda: 'cola', pop: 'cola', coke: 'cola', advil: 'ibuprofen', motrin: 'ibuprofen', tylenol: 'acetaminophen',
  painkiller: 'pain', claritin: 'loratadine', tp: 'bath tissue', 'toilet': 'bath', nappies: 'diapers', charger: 'charging',
  gas: 'fuel', groceries: 'grocery', meds: 'pain', h2o: 'water', kolache: 'kolaches', smokes: '',
};

/** Remove filler words ("show", "near me", "stores") and map synonyms so both data stores see the meaningful terms. */
export function cleanQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.toLowerCase().replace(/[^a-z]/g, '')))
    .map((w) => {
      const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
      return k in SYNONYMS ? SYNONYMS[k] : w;
    })
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Score query against weighted fields. Every query token must match some field token
 * (prefix, substring or within an edit distance of 1–2) for a non-zero score.
 */
export function scoreText(query: string, fields: { text: string; weight: number }[]): number {
  const q = tokens(query).filter((t) => !STOP.has(t));
  if (q.length === 0) return 0;
  const fieldTokens = fields.map((f) => ({ toks: tokens(f.text), weight: f.weight, full: normalize(f.text) }));
  let total = 0;
  for (const qt of q) {
    let best = 0;
    const singular = qt.endsWith('s') && qt.length > 3 ? qt.slice(0, -1) : qt;
    for (const f of fieldTokens) {
      for (const ft of f.toks) {
        let s = 0;
        if (ft === qt || ft === singular) s = 1;
        else if (ft.startsWith(singular)) s = 0.85;
        else if (singular.length >= 4 && ft.includes(singular)) s = 0.6;
        else if (singular.length >= 4) {
          const d = levenshtein(singular, ft.slice(0, Math.max(singular.length, ft.length)), singular.length > 6 ? 2 : 1);
          if (d <= (singular.length > 6 ? 2 : 1)) s = 0.55;
        }
        best = Math.max(best, s * f.weight);
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  const maxWeight = Math.max(...fields.map((f) => f.weight));
  let score = total / (q.length * maxWeight);
  const nq = normalize(query);
  if (fieldTokens.some((f) => f.full === nq)) score = Math.min(1, score + 0.2);
  return Math.min(1, score);
}
