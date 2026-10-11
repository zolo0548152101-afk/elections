import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** Simple in-memory rate limit: max attempts per email+IP window. */
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
  const body = (await req.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "חסרים פרטי התחברות" }, { status: 400 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  if (rateLimited(`${ip}:${email}`)) {
    return NextResponse.json(
      { error: "יותר מדי ניסיונות. נסו שוב בעוד דקה." },
      { status: 429 },
    );
  }

  const sql = getSql();
  const rows = (await sql`
    SELECT id, password_hash FROM users WHERE lower(email) = ${email} LIMIT 1
  `) as { id: number; password_hash: string }[];
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) {
    return NextResponse.json({ error: "אימייל או סיסמה שגויים" }, { status: 401 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
