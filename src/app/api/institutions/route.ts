import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sql = getSql();
  if (user!.role === "area_manager") {
    const rows = await sql`
      SELECT DISTINCT i.id, i.name, i.created_at
      FROM institutions i
      JOIN users u ON u.institution_id = i.id
      WHERE u.manager_id = ${user!.id}
      ORDER BY i.name
    `;
    return NextResponse.json({ institutions: rows });
  }
  const rows = await sql`SELECT id, name, created_at FROM institutions ORDER BY name`;
  return NextResponse.json({ institutions: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO institutions (name) VALUES (${name})
    ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id, name, created_at
  `;
  return NextResponse.json({ institution: row });
}
