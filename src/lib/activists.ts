export const SHIRT_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "3XL"] as const;

export type ShirtSize = (typeof SHIRT_SIZES)[number];

export function isShirtSize(value: string): value is ShirtSize {
  return (SHIRT_SIZES as readonly string[]).includes(value);
}

export function cleanActivistName(raw: string) {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 80) return null;
  if (!/\p{L}/u.test(name)) return null;
  return name;
}

export function formatMobileDisplay(mobile: string) {
  if (!/^05\d{8}$/.test(mobile)) return mobile;
  return `${mobile.slice(0, 3)}-${mobile.slice(3)}`;
}
