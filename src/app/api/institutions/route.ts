import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole, type SessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

const KINDS = [
  "ישיבת הסדר",
  "ישיבה תיכונית",
  "גרעין",
  "מדרשה",
  "אולפנה",
  "מוסד חינוך",
];

async function availableCoordinators(
  sql: ReturnType<typeof getSql>,
  user: SessionUser,
) {
  if (user.role === "super_admin") {
    return sql`
      SELECT id, full_name, email, institution_id
      FROM users
      WHERE role = 'coordinator'
      ORDER BY full_name
    `;
  }
  if (user.role === "area_manager") {
    return sql`
      SELECT id, full_name, email, institution_id
      FROM users
      WHERE role = 'coordinator' AND manager_id = ${user.id}
      ORDER BY full_name
    `;
  }
  return [];
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();

  if (user.role === "coordinator") {
    if (!user.institution_id) {
      return NextResponse.json({
        institutions: [],
        kinds: KINDS,
        message: "לא שויך מוסד למשתמש זה — פנו למנהל",
      });
    }
    const rows = await sql`
      SELECT i.id, i.name, i.kind, i.settlement_name, i.district, i.lat, i.lng,
             i.key_people_raw, i.created_at,
             coalesce(
               (
                 SELECT json_agg(
                   json_build_object(
                     'id', c.id,
                     'full_name', c.full_name,
                     'role_title', c.role_title,
                     'phone', c.phone
                   )
                   ORDER BY c.sort_order, c.id
                 )
                 FROM institution_contacts c
                 WHERE c.institution_id = i.id
               ),
               '[]'
             ) AS contacts,
             coalesce(
               (
                 SELECT json_agg(
                   json_build_object(
                     'ashkol', ic.ashkol,
                     'settlement_name', cl.settlement_name,
                     'right_pct', cl.right_pct,
                     'turnout_pct', cl.turnout_pct,
                     'bzb', cl.bzb
                   )
                   ORDER BY cl.settlement_name, ic.ashkol
                 )
                 FROM institution_clusters ic
                 JOIN clusters cl ON cl.ashkol = ic.ashkol
                 WHERE ic.institution_id = i.id
               ),
               '[]'
             ) AS linked_clusters,
             coalesce(
               (
                 SELECT json_agg(
                   json_build_object(
                     'id', u.id,
                     'full_name', u.full_name,
                     'email', u.email
                   )
                   ORDER BY u.full_name
                 )
                 FROM users u
                 WHERE u.role = 'coordinator' AND u.institution_id = i.id
               ),
               '[]'
             ) AS coordinators
      FROM institutions i
      WHERE i.id = ${user.institution_id}
    `;
    return NextResponse.json({ institutions: rows, kinds: KINDS });
  }

  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows =
    user.role === "area_manager"
      ? await sql`
          SELECT i.id, i.name, i.kind, i.settlement_name, i.district, i.lat, i.lng,
                 i.key_people_raw, i.created_at,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', c.id,
                         'full_name', c.full_name,
                         'role_title', c.role_title,
                         'phone', c.phone
                       )
                       ORDER BY c.sort_order, c.id
                     )
                     FROM institution_contacts c
                     WHERE c.institution_id = i.id
                   ),
                   '[]'
                 ) AS contacts,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'ashkol', ic.ashkol,
                         'settlement_name', cl.settlement_name,
                         'right_pct', cl.right_pct,
                         'turnout_pct', cl.turnout_pct,
                         'bzb', cl.bzb
                       )
                       ORDER BY cl.settlement_name, ic.ashkol
                     )
                     FROM institution_clusters ic
                     JOIN clusters cl ON cl.ashkol = ic.ashkol
                     WHERE ic.institution_id = i.id
                   ),
                   '[]'
                 ) AS linked_clusters,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', u.id,
                         'full_name', u.full_name,
                         'email', u.email
                       )
                       ORDER BY u.full_name
                     )
                     FROM users u
                     WHERE u.role = 'coordinator'
                       AND u.institution_id = i.id
                       AND u.manager_id = ${user.id}
                   ),
                   '[]'
                 ) AS coordinators
          FROM institutions i
          ORDER BY i.name
        `
      : await sql`
          SELECT i.id, i.name, i.kind, i.settlement_name, i.district, i.lat, i.lng,
                 i.key_people_raw, i.created_at,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', c.id,
                         'full_name', c.full_name,
                         'role_title', c.role_title,
                         'phone', c.phone
                       )
                       ORDER BY c.sort_order, c.id
                     )
                     FROM institution_contacts c
                     WHERE c.institution_id = i.id
                   ),
                   '[]'
                 ) AS contacts,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'ashkol', ic.ashkol,
                         'settlement_name', cl.settlement_name,
                         'right_pct', cl.right_pct,
                         'turnout_pct', cl.turnout_pct,
                         'bzb', cl.bzb
                       )
                       ORDER BY cl.settlement_name, ic.ashkol
                     )
                     FROM institution_clusters ic
                     JOIN clusters cl ON cl.ashkol = ic.ashkol
                     WHERE ic.institution_id = i.id
                   ),
                   '[]'
                 ) AS linked_clusters,
                 coalesce(
                   (
                     SELECT json_agg(
                       json_build_object(
                         'id', u.id,
                         'full_name', u.full_name,
                         'email', u.email
                       )
                       ORDER BY u.full_name
                     )
                     FROM users u
                     WHERE u.role = 'coordinator' AND u.institution_id = i.id
                   ),
                   '[]'
                 ) AS coordinators
          FROM institutions i
          ORDER BY i.name
        `;

  const pickable = await availableCoordinators(sql, user);
  return NextResponse.json({
    institutions: rows,
    kinds: KINDS,
    available_coordinators: pickable,
  });
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
    kind?: string;
    settlement_name?: string;
    district?: string;
    lat?: number | null;
    lng?: number | null;
    key_people_raw?: string;
  };
  const name = body.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
  const kind = body.kind?.trim() || null;
  if (kind && !KINDS.includes(kind)) {
    return NextResponse.json({ error: "סוג מוסד לא חוקי" }, { status: 400 });
  }

  const sql = getSql();
  const [row] = await sql`
    INSERT INTO institutions (
      name, kind, settlement_name, district, lat, lng, key_people_raw
    ) VALUES (
      ${name},
      ${kind},
      ${body.settlement_name?.trim() || null},
      ${body.district?.trim() || null},
      ${body.lat ?? null},
      ${body.lng ?? null},
      ${body.key_people_raw?.trim() || null}
    )
    ON CONFLICT (name) DO UPDATE SET
      kind = EXCLUDED.kind,
      settlement_name = EXCLUDED.settlement_name,
      district = EXCLUDED.district,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      key_people_raw = EXCLUDED.key_people_raw
    RETURNING id, name, kind, settlement_name, district, lat, lng, key_people_raw, created_at
  `;
  return NextResponse.json({ institution: row });
}
