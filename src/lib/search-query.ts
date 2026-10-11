/** Strip Hebrew/ASCII quote marks so הרמב"ם and הרמבם match. */
export function stripQuotes(value: string) {
  return value.replace(/['׳״"`]+/g, "");
}

export function sanitizeSearchInput(raw: string) {
  return stripQuotes(raw)
    .replace(/[%_\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type CityRow = { name_he: string; lat: number; lng: number };

/**
 * Longest settlement name that is a prefix of the query (e.g. "בית שאן הרמבם").
 * Settlements should already be sorted by name length descending.
 */
export function longestCityPrefix(
  query: string,
  settlements: CityRow[],
): { city: CityRow; remainder: string } | null {
  const q = sanitizeSearchInput(query).toLowerCase();
  for (const city of settlements) {
    const name = sanitizeSearchInput(city.name_he).toLowerCase();
    if (!name) continue;
    if (q === name) return { city, remainder: "" };
    if (q.startsWith(`${name} `)) {
      return { city, remainder: q.slice(name.length).trim() };
    }
  }
  return null;
}
