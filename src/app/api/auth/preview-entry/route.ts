import { NextRequest, NextResponse } from "next/server";
import { createSession, type Role } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

const ROLES = ["super_admin", "area_manager", "coordinator"] as const;

function previewEntryEnabled() {
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "development") return true;
  return process.env.NODE_ENV !== "production";
}

export async function GET() {
  return NextResponse.json({ enabled: previewEntryEnabled() });
}

export async function POST(req: NextRequest) {
  if (!previewEntryEnabled()) {
    return NextResponse.json({ error: "לא זמין" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as { role?: string };
  const role = body.role;
  if (!role || !ROLES.includes(role as (typeof ROLES)[number])) {
    return NextResponse.json({ error: "תפקיד לא תקין" }, { status: 400 });
  }
  const sql = getSql();
  const rows = (await sql`
    SELECT id FROM users WHERE role = ${role} ORDER BY id LIMIT 1
  `) as { id: number }[];
  const user = rows[0];
  if (!user) {
    return NextResponse.json({ error: "אין משתמש בתפקיד זה" }, { status: 404 });
  }
  await createSession(user.id);
  return NextResponse.json({ ok: true, role: role as Role });
}
