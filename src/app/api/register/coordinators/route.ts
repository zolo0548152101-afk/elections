import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { cleanSignupText, isCoordinatorSignupKind } from "@/lib/coordinator-signups";
import { normalizeMobileLocal } from "@/lib/mobile";

export const runtime = "nodejs";

/** Public coordinator sign-up: name, mobile, institution type, institution (free text). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    first_name?: unknown;
    last_name?: unknown;
    mobile?: unknown;
    institution_name?: unknown;
    institution_kind?: unknown;
  };
  const firstName = cleanSignupText(String(body.first_name ?? ""), 40);
  const lastName = cleanSignupText(String(body.last_name ?? ""), 40);
  const mobile = normalizeMobileLocal(String(body.mobile ?? ""));
  const institutionName = cleanSignupText(String(body.institution_name ?? ""), 80);
  const kind = String(body.institution_kind ?? "");

  if (!firstName) return NextResponse.json({ error: "כתבו שם פרטי" }, { status: 400 });
  if (!lastName) return NextResponse.json({ error: "כתבו שם משפחה" }, { status: 400 });
  if (!mobile) return NextResponse.json({ error: "נייד לא תקין" }, { status: 400 });
  if (!institutionName) return NextResponse.json({ error: "כתבו את שם המוסד" }, { status: 400 });
  if (!isCoordinatorSignupKind(kind)) {
    return NextResponse.json({ error: "בחרו סוג מוסד" }, { status: 400 });
  }

  const sql = getSql();
  // Public page: cap repeats per phone and the overall burst rate.
  const [recent] = (await sql`
    SELECT count(*) FILTER (WHERE mobile = ${mobile})::int AS mine,
           count(*)::int AS n
    FROM coordinator_signups
    WHERE updated_at > now() - interval '1 minute'
  `) as { mine: number; n: number }[];
  if ((recent?.mine ?? 0) >= 5 || (recent?.n ?? 0) >= 30) {
    return NextResponse.json({ error: "יותר מדי הרשמות כרגע. נסו שוב בעוד דקה." }, { status: 429 });
  }

  // One row per phone: signing up again updates the details instead of duplicating.
  await sql`
    INSERT INTO coordinator_signups (first_name, last_name, mobile, institution_name, institution_kind)
    VALUES (${firstName}, ${lastName}, ${mobile}, ${institutionName}, ${kind})
    ON CONFLICT (mobile) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      institution_name = EXCLUDED.institution_name,
      institution_kind = EXCLUDED.institution_kind,
      updated_at = now()
  `;

  return NextResponse.json({
    ok: true,
    first_name: firstName,
    last_name: lastName,
    institution_name: institutionName,
    institution_kind: kind,
  });
}
