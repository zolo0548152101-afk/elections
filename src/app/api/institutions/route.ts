import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole, type SessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import {
  coordinatorInstitutionIds,
  syncPrimaryInstitution,
} from "@/lib/streets-access";

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
    const ids = await coordinatorInstitutionIds(sql, user.id);
    if (ids.length === 0) {
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
                 FROM institution_coordinators link
                 JOIN users u ON u.id = link.user_id
                 WHERE link.institution_id = i.id AND u.role = 'coordinator'
               ),
               '[]'
             ) AS coordinators
      FROM institutions i
      WHERE i.id = ANY(${ids})
      ORDER BY i.name
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
                     FROM institution_coordinators link
                     JOIN users u ON u.id = link.user_id
                     WHERE link.institution_id = i.id
                       AND u.role = 'coordinator'
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
                     FROM institution_coordinators link
                     JOIN users u ON u.id = link.user_id
                     WHERE link.institution_id = i.id AND u.role = 'coordinator'
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
    contact_name?: string;
    contact_phone?: string;
    coordinator_user_id?: number | null;
  };
  const name = body.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "שם חובה" }, { status: 400 });
  const kind = body.kind?.trim() || null;
  if (kind && !KINDS.includes(kind)) {
    return NextResponse.json({ error: "סוג מוסד לא חוקי" }, { status: 400 });
  }

  const contactName = body.contact_name?.trim() ?? "";
  const contactPhone = body.contact_phone?.trim() ?? "";
  const coordinatorUserId =
    body.coordinator_user_id == null || body.coordinator_user_id === 0
      ? null
      : Number(body.coordinator_user_id);

  const sql = getSql();

  if (coordinatorUserId != null) {
    if (!Number.isInteger(coordinatorUserId)) {
      return NextResponse.json({ error: "רכז לא חוקי" }, { status: 400 });
    }
    const [target] = (await sql`
      SELECT id, role, manager_id FROM users WHERE id = ${coordinatorUserId} LIMIT 1
    `) as { id: number; role: string; manager_id: number | null }[];
    if (!target || target.role !== "coordinator") {
      return NextResponse.json(
        { error: "ניתן לשייך רק משתמש בתפקיד רכז" },
        { status: 400 },
      );
    }
    if (user!.role === "area_manager" && target.manager_id !== user!.id) {
      return NextResponse.json({ error: "רכז מחוץ לצוות" }, { status: 403 });
    }
  }

  const keyPeople =
    body.key_people_raw?.trim() ||
    (contactName
      ? `${contactName}${contactPhone ? ` ${contactPhone}` : ""}`
      : null);

  const [row] = (await sql`
    INSERT INTO institutions (
      name, kind, settlement_name, district, lat, lng, key_people_raw
    ) VALUES (
      ${name},
      ${kind},
      ${body.settlement_name?.trim() || null},
      ${body.district?.trim() || null},
      ${body.lat ?? null},
      ${body.lng ?? null},
      ${keyPeople}
    )
    ON CONFLICT (name) DO UPDATE SET
      kind = EXCLUDED.kind,
      settlement_name = EXCLUDED.settlement_name,
      district = EXCLUDED.district,
      lat = EXCLUDED.lat,
      lng = EXCLUDED.lng,
      key_people_raw = COALESCE(EXCLUDED.key_people_raw, institutions.key_people_raw)
    RETURNING id, name, kind, settlement_name, district, lat, lng, key_people_raw, created_at
  `) as { id: number }[];

  if (!row) {
    return NextResponse.json({ error: "שגיאה ביצירת מוסד" }, { status: 500 });
  }

  if (contactName) {
    await sql`
      INSERT INTO institution_contacts (
        institution_id, full_name, role_title, phone, sort_order
      ) VALUES (
        ${row.id}, ${contactName}, 'איש קשר', ${contactPhone}, 0
      )
    `;
  }

  if (coordinatorUserId != null) {
    await sql`
      INSERT INTO institution_coordinators (institution_id, user_id, linked_by)
      VALUES (${row.id}, ${coordinatorUserId}, ${user!.id})
      ON CONFLICT DO NOTHING
    `;
    await syncPrimaryInstitution(sql, coordinatorUserId);
  }

  return NextResponse.json({ institution: row });
}
