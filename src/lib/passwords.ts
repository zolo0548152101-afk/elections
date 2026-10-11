export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    return `סיסמה חייבת לפחות ${MIN_PASSWORD_LENGTH} תווים`;
  }
  return null;
}
