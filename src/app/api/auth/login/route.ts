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
    SELECT id, password_hash
    FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${variants})
    LIMIT 2
  `) as { id: number; password_hash: string }[];

  if (rows.length > 1) {
    return NextResponse.json(
      { error: "מספר נייד משויך ליותר ממשתמש אחד — פנו למנהל" },
      { status: 409 },
    );
  }

  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "נייד או סיסמה שגויים" }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
