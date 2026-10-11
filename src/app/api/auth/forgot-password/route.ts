import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { appLoginUrl } from "@/lib/app-url";
import { getSql } from "@/lib/db";
import { mobileMatchVariants, normalizeMobileLocal } from "@/lib/mobile";
import { generateTempPassword } from "@/lib/passwords";
import { wahaSendText } from "@/lib/waha";

export const runtime = "nodejs";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now >= entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/**
 * Public: send a temporary password over WAHA (HAIM_YAHAD) for forgot-password.
 * Always returns a generic success when the mobile format is valid (anti-enumeration).
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { mobile?: string };
  const mobile = normalizeMobileLocal(body.mobile ?? "");
  if (!mobile) {
    return NextResponse.json(
      { error: "הזינו מספר נייד תקין (05…)" },
      { status: 400 },
    );
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(`${ip}:${mobile}`)) {
    return NextResponse.json(
      { error: "יותר מדי ניסיונות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const variants = mobileMatchVariants(mobile);
  const sql = getSql();
  const rows = (await sql`
    SELECT id, full_name, mobile
    FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
    LIMIT 2
  `) as { id: number; full_name: string; mobile: string | null }[];

  const genericOk = {
    ok: true,
    message:
      "אם קיים משתמש עם מספר זה, נשלחה סיסמה זמנית ב-WhatsApp. התחברו איתה מיד.",
  };

  if (rows.length !== 1 || !rows[0].mobile?.trim()) {
    return NextResponse.json(genericOk);
  }

  const user = rows[0];
  const temp = generateTempPassword();
  const hash = hashPassword(temp);
  await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}`;

  const loginUrl = appLoginUrl(req);
  const text = [
    "שלום, הנה סיסמה זמנית לכניסה חד-פעמית למערכת.",
    `לינק להתחברות- ${loginUrl}`,
    `משתמש- ${mobile}`,
    `סיסמא זמנית- ${temp}`,
    "מומלץ להחליף סיסמה אחרי הכניסה.",
  ].join("\n");

  const sent = await wahaSendText({ mobile: user.mobile!, text });
  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || "שליחת WhatsApp נכשלה" },
      { status: 502 },
    );
  }

  return NextResponse.json(genericOk);
}
