/** Normalize Hebrew/Latin search text for substring matching. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['׳״"`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when every whitespace token of `needle` appears somewhere in `hay`. */
export function matchesSearch(hay: string, needle: string): boolean {
  const h = normalizeSearch(hay);
  const n = normalizeSearch(needle);
  if (!n) return true;
  return n.split(" ").every((token) => token && h.includes(token));
}
