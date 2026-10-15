import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** Admin list of coordinator sign-ups. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const sql = getSql();
  const signups = await sql`
    SELECT id, first_name, last_name, mobile, institution_name, institution_kind, created_at, updated_at
    FROM coordinator_signups
    ORDER BY created_at DESC
    LIMIT 2000
  `;
  return NextResponse.json({ signups });
}
