import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import {
  allowedAssignTargets,
  canAssignStreetTo,
} from "@/lib/streets-access";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const sql = getSql();
  const exists = (await sql`
    SELECT id, name_he, ashkol, lat, lng FROM streets WHERE id = ${id} LIMIT 1
  `) as { id: string; name_he: string; ashkol: string | null; lat: number; lng: number }[];
  if (!exists[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const assigned = (await sql`
    SELECT u.id, u.full_name, u.institution_id, sc.assigned_at
    FROM street_coordinators sc
    JOIN users u ON u.id = sc.user_id
    WHERE sc.street_id = ${id}
    ORDER BY u.full_name
  `) as { id: number; full_name: string; institution_id: number | null; assigned_at: string }[];

  const allowed = await allowedAssignTargets(sql, user, id);

  return NextResponse.json({
    street: exists[0],
    assigned,
    allowed,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json()) as { user_id?: number };
  const targetId = Number(body.user_id);
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "user_id חסר" }, { status: 400 });
  }

  const sql = getSql();
  const ok = await canAssignStreetTo(sql, user, id, targetId);
  if (!ok) {
    return NextResponse.json(
      { error: "אין הרשאה להוסיף רחוב לרכז זה בעיר זו" },
      { status: 403 },
    );
  }

  await sql`
    INSERT INTO street_coordinators (street_id, user_id, assigned_by)
    VALUES (${id}, ${targetId}, ${user.id})
    ON CONFLICT DO NOTHING
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const targetId = Number(req.nextUrl.searchParams.get("user_id"));
  if (!Number.isInteger(targetId)) {
    return NextResponse.json({ error: "user_id חסר" }, { status: 400 });
  }

  const sql = getSql();
  const ok = await canAssignStreetTo(sql, user, id, targetId);
  if (!ok) {
    return NextResponse.json({ error: "אין הרשאה להסיר שיוך זה" }, { status: 403 });
  }

  await sql`
    DELETE FROM street_coordinators
    WHERE street_id = ${id} AND user_id = ${targetId}
  `;

  return NextResponse.json({ ok: true });
}
