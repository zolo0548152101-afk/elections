import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sql = getSql();

  if (user.role === "coordinator") {
    const rows = await sql`
      SELECT g.*, coalesce(json_agg(json_build_object('id', u.id, 'full_name', u.full_name))
        FILTER (WHERE u.id IS NOT NULL), '[]') AS coordinators
      FROM groups g
      JOIN group_coordinators gc ON gc.group_id = g.id
      LEFT JOIN group_coordinators gc2 ON gc2.group_id = g.id
      LEFT JOIN users u ON u.id = gc2.user_id
      WHERE gc.user_id = ${user.id}
      GROUP BY g.id
      ORDER BY g.name
    `;
    return NextResponse.json({ groups: rows });
  }

  if (user.role === "area_manager") {
    const rows = await sql`
      SELECT g.*, coalesce(json_agg(DISTINCT jsonb_build_object('id', u.id, 'full_name', u.full_name))
        FILTER (WHERE u.id IS NOT NULL), '[]') AS coordinators
      FROM groups g
      JOIN group_coordinators gc ON gc.group_id = g.id
      JOIN users coord ON coord.id = gc.user_id AND coord.manager_id = ${user.id}
      LEFT JOIN group_coordinators gc2 ON gc2.group_id = g.id
      LEFT JOIN users u ON u.id = gc2.user_id
      GROUP BY g.id
      ORDER BY g.name
    `;
    return NextResponse.json({ groups: rows });
  }

  const rows = await sql`
    SELECT g.*, coalesce(json_agg(json_build_object('id', u.id, 'full_name', u.full_name))
      FILTER (WHERE u.id IS NOT NULL), '[]') AS coordinators
    FROM groups g
    LEFT JOIN group_coordinators gc ON gc.group_id = g.id
    LEFT JOIN users u ON u.id = gc.user_id
    GROUP BY g.id
    ORDER BY g.name
  `;
  return NextResponse.json({ groups: rows });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    name?: string;
    location_text?: string;
    settlement_name?: string;
    headcount?: number;
    gender?: string;
    type?: string;
    coordinator_ids?: number[];
  };

  const name = body.name?.trim() ?? "";
  const location_text = body.location_text?.trim() ?? "";
  const settlement_name = body.settlement_name?.trim() ?? "";
  const headcount = Number(body.headcount ?? 0);
  const gender = body.gender?.trim() ?? "";
  const type = body.type ?? "";
  const coordinatorIds = Array.isArray(body.coordinator_ids) ? body.coordinator_ids : [];

  if (
    !name ||
    !location_text ||
    !settlement_name ||
    !["yeshiva", "garin", "mechina"].includes(type)
  ) {
    return NextResponse.json({ error: "שדות חובה חסרים" }, { status: 400 });
  }

  const sql = getSql();
  const settlement = (await sql`
    SELECT name_he FROM settlements WHERE name_he = ${settlement_name} LIMIT 1
  `) as { name_he: string }[];
  if (!settlement[0]) {
    return NextResponse.json({ error: "יש לבחור יישוב מהרשימה" }, { status: 400 });
  }

  const ids = coordinatorIds.map((id) => Number(id)).filter((id) => Number.isInteger(id));
  if (user!.role === "area_manager" && ids.length > 0) {
    const allowed = (await sql`
      SELECT id FROM users
      WHERE role = 'coordinator' AND manager_id = ${user!.id}
    `) as { id: number }[];
    const allowedIds = new Set(allowed.map((row) => row.id));
    if (ids.some((id) => !allowedIds.has(id))) {
      return NextResponse.json({ error: "רכז מחוץ לצוות" }, { status: 403 });
    }
  }

  const [group] = await sql`
    INSERT INTO groups (name, location_text, settlement_name, headcount, gender, type)
    VALUES (${name}, ${location_text}, ${settlement_name}, ${headcount}, ${gender}, ${type})
    RETURNING *
  `;

  for (const cid of ids) {
    await sql`
      INSERT INTO group_coordinators (group_id, user_id)
      VALUES (${group.id}, ${cid})
      ON CONFLICT DO NOTHING
    `;
  }

  return NextResponse.json({ group });
}
