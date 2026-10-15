/** Institution types a coordinator can pick on the public sign-up page. */
export const COORDINATOR_SIGNUP_KINDS = ["מכינה", "ישיבה גבוהה", "ישיבת הסדר"] as const;

export type CoordinatorSignupKind = (typeof COORDINATOR_SIGNUP_KINDS)[number];

export function isCoordinatorSignupKind(value: string): value is CoordinatorSignupKind {
  return (COORDINATOR_SIGNUP_KINDS as readonly string[]).includes(value);
}

/** Collapse spaces; 1–60 chars with at least one letter. */
export function cleanSignupText(raw: string, max = 60) {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length < 1 || value.length > max) return null;
  if (!/\p{L}/u.test(value)) return null;
  return value;
}
