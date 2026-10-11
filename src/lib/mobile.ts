/** Canonical Israeli mobile for login/display: 05XXXXXXXX */
export function normalizeMobileLocal(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  else if (digits.length === 9 && digits.startsWith("5")) digits = `0${digits}`;
  if (!/^05\d{8}$/.test(digits)) return null;
  return digits;
}

/** Digit variants to match a stored mobile field. */
export function mobileMatchVariants(input: string): string[] {
  const local = normalizeMobileLocal(input);
  if (!local) return [];
  const national = local.slice(1); // 5xxxxxxxx
  const intl = `972${national}`;
  return [local, national, intl];
}
