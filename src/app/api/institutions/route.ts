import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
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

export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const sql = getSql();
  const rows = await sql`
    SELECT i.id, i.name, i.kind, i.settlement_name, i.district, i.lat, i.lng,
           i.key_people_raw, i.created_at,
           coalesce(
             json_agg(
               json_build_object(
                 'id', c.id,
                 'full_name', c.full_name,
                 'role_title', c.role_title,
                 'phone', c.phone
               )
               ORDER BY c.sort_order, c.id
             ) FILTER (WHERE c.id IS NOT NULL),
             '[]'
           ) AS contacts
    FROM institutions i
    LEFT JOIN institution_contacts c ON c.institution_id = i.id
    GROUP BY i.id
    ORDER BY i.name
  `;
  return NextResponse.json({ institutions: rows, kinds: KINDS });
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
