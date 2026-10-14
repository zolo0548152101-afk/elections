/** Report palette first, then more distinct colors. Assigned in ashkol order within a town. */
export const ESHKOL_HOUSE_COLORS = [
  "#c23b3b",
  "#1f7a4d",
  "#2c5aa0",
  "#c48a1a",
  "#6b4c9a",
  "#0f766e",
  "#b45309",
  "#be185d",
  "#1d4ed8",
  "#4d7c0f",
  "#7c3aed",
  "#0e7490",
] as const;

export function eshkolColorMap(ashkols: string[]): Map<string, string> {
  const sorted = [...new Set(ashkols)].sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  const colors = new Map<string, string>();
  sorted.forEach((ashkol, i) => {
    colors.set(ashkol, ESHKOL_HOUSE_COLORS[i % ESHKOL_HOUSE_COLORS.length]);
  });
  return colors;
}
