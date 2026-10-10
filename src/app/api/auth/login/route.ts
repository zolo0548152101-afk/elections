import { NextRequest, NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { email?: string; password?: string };
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ error: "חסרים פרטי התחברות" }, { status: 400 });
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
