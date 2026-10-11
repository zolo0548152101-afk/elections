import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { mobileMatchVariants, normalizeMobileLocal } from "@/lib/mobile";

export const runtime = "nodejs";

/** Simple in-memory rate limit: max attempts per mobile+IP window. */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
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

type LoginUser = {
  id: number;
  password_hash: string;
  temp_login_code_hash: string | null;
  temp_login_expires_at: string | Date | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    mobile?: string;
    email?: string;
    password?: string;
  };
  // Prefer mobile; accept legacy `email` field if it looks like a phone.
  const rawMobile = (body.mobile ?? body.email ?? "").trim();
  const password = body.password ?? "";
  const mobile = normalizeMobileLocal(rawMobile);
  if (!mobile || !password) {
    return NextResponse.json({ error: "חסרים פרטי התחברות" }, { status: 400 });
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
    SELECT id, password_hash, temp_login_code_hash, temp_login_expires_at
    FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
    LIMIT 2
  `) as LoginUser[];

  if (rows.length > 1) {
    return NextResponse.json(
      { error: "מספר נייד משויך ליותר ממשתמש אחד — פנו למנהל" },
      { status: 409 },
    );
  }

  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "נייד או סיסמה שגויים" }, { status: 401 });
  }

  if (verifyPassword(password, user.password_hash)) {
    await createSession(user.id);
    return NextResponse.json({ ok: true });
  }

  const tempHash = user.temp_login_code_hash?.trim() || "";
  const expiresAt = user.temp_login_expires_at
    ? new Date(user.temp_login_expires_at).getTime()
    : 0;
  const tempValid =
    tempHash &&
    expiresAt > Date.now() &&
    verifyPassword(password, tempHash);

  if (!tempValid) {
    return NextResponse.json({ error: "נייד או סיסמה שגויים" }, { status: 401 });
  }

  // One-time: clear temp code after successful login. Permanent password stays.
  await sql`
    UPDATE users
    SET temp_login_code_hash = NULL,
        temp_login_expires_at = NULL
    WHERE id = ${user.id}
  `;
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
