import { NextRequest, NextResponse } from "next/server";
import { cleanActivistName, isShirtSize } from "@/lib/activists";
import { getSql } from "@/lib/db";
import { normalizeMobileLocal } from "@/lib/mobile";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("institution"));
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ institution: null });
  }
  const sql = getSql();
  const [row] = (await sql`
    SELECT id, name, settlement_name
    FROM institutions
    WHERE id = ${id}
    LIMIT 1
  `) as { id: number; name: string; settlement_name: string | null }[];
  if (!row) return NextResponse.json({ institution: null });
  return NextResponse.json({
    institution: {
      id: row.id,
      name: row.name,
      settlement_name: row.settlement_name,
      label: [row.name, row.settlement_name].filter(Boolean).join(" · "),
    },
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    institution_id?: unknown;
    full_name?: unknown;
    mobile?: unknown;
    shirt_size?: unknown;
  };
  const institutionId = Number(body.institution_id);
  const fullName = cleanActivistName(String(body.full_name ?? ""));
  const mobile = normalizeMobileLocal(String(body.mobile ?? ""));
  const shirt = String(body.shirt_size ?? "");

  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    return NextResponse.json({ error: "בחרו מוסד מהרשימה" }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "כתבו שם מלא" }, { status: 400 });
  }
  if (!mobile) {
    return NextResponse.json({ error: "נייד לא תקין" }, { status: 400 });
  }
  if (!isShirtSize(shirt)) {
    return NextResponse.json({ error: "בחרו מידת חולצה" }, { status: 400 });
  }

  const sql = getSql();
  const [institution] = (await sql`
    SELECT id, name FROM institutions WHERE id = ${institutionId} LIMIT 1
  `) as { id: number; name: string }[];
  if (!institution) {
    return NextResponse.json({ error: "המוסד לא נמצא" }, { status: 400 });
  }

  const recent = (await sql`
    SELECT count(*)::int AS n
    FROM activists
    WHERE mobile = ${mobile}
      AND updated_at > now() - interval '10 minutes'
  `) as { n: number }[];
  if ((recent[0]?.n ?? 0) >= 8) {
    return NextResponse.json({ error: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." }, { status: 429 });
  }

  await sql`
    INSERT INTO activists (institution_id, full_name, mobile, shirt_size)
    VALUES (${institutionId}, ${fullName}, ${mobile}, ${shirt})
    ON CONFLICT (institution_id, mobile) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      shirt_size = EXCLUDED.shirt_size,
      updated_at = now()
  `;

  return NextResponse.json({
    ok: true,
    message: "ההרשמה נקלטה.",
    full_name: fullName,
    institution_name: institution.name,
    shirt_size: shirt,
  });
}
