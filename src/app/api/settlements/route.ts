import { NextResponse } from "next/server";
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
  const rows = await sql`
    SELECT name_he, lat, lng FROM settlements ORDER BY name_he
  `;
  return NextResponse.json({ settlements: rows });
}
