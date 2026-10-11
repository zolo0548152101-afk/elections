/** Display ashkol with its settlement, e.g. "920020 · מודיעין". */
export function formatAshkolLabel(
  ashkol: string,
  settlementName?: string | null,
): string {
  const id = String(ashkol ?? "").trim();
  if (!id) return "";
  const place = String(settlementName ?? "").trim();
  return place ? `${id} · ${place}` : id;
}

export function formatAshkolLabels(
  items: { ashkol: string; settlement_name?: string | null }[],
  sep = ", ",
): string {
  return items
    .map((c) => formatAshkolLabel(c.ashkol, c.settlement_name))
    .filter(Boolean)
    .join(sep);
}
