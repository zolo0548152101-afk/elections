import { randomBytes } from "crypto";

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `סיסמה חייבת לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  }
  return null;
}

/** Temporary password for WhatsApp one-time login (min 8 chars). */
export function generateTempPassword(): string {
  return randomBytes(8).toString("base64url").slice(0, 10);
}
