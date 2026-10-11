import { randomBytes, randomInt } from "crypto";

export const MIN_PASSWORD_LENGTH = 8;
/** Digits-only one-time login code length. */
export const TEMP_LOGIN_CODE_LENGTH = 5;
/** How long a temporary login code remains valid. */
export const TEMP_LOGIN_TTL_MS = 5 * 60 * 1000;

export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `סיסמה חייבת לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  }
  return null;
}

/** Random permanent password for WhatsApp credential sends (min 8 chars). */
export function generateRandomPassword(): string {
  return randomBytes(8).toString("base64url").slice(0, 10);
}

/**
 * Temporary one-time login code: exactly 5 digits, no letters/symbols.
 * Does not replace the user's permanent password.
 */
export function generateTempLoginCode(): string {
  return String(randomInt(0, 10 ** TEMP_LOGIN_CODE_LENGTH)).padStart(
    TEMP_LOGIN_CODE_LENGTH,
    "0",
  );
}
