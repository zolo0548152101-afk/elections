import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { cleanSignupText, isCoordinatorSignupKind } from "@/lib/coordinator-signups";

export const runtime = "nodejs";

/** Public coordinator sign-up: first name, last name, institution (free text), institution type. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    first_name?: unknown;
    last_name?: unknown;
    institution_name?: unknown;
    institution_kind?: unknown;
  };
  const firstName = cleanSignupText(String(body.first_name ?? ""), 40);
  const lastName = cleanSignupText(String(body.last_name ?? ""), 40);
  const institutionName = cleanSignupText(String(body.institution_name ?? ""), 80);
  const kind = String(body.institution_kind ?? "");

  if (!firstName) return NextResponse.json({ error: "כתבו שם פרטי" }, { status: 400 });
  if (!lastName) return NextResponse.json({ error: "כתבו שם משפחה" }, { status: 400 });
  if (!institutionName) return NextResponse.json({ error: "כתבו את שם המוסד" }, { status: 400 });
  if (!isCoordinatorSignupKind(kind)) {
    return NextResponse.json({ error: "בחרו סוג מוסד" }, { status: 400 });
  }

  const sql = getSql();
  // The page is public and has no phone/login, so cap the overall burst rate.
  const [recent] = (await sql`
    SELECT count(*)::int AS n
    FROM coordinator_signups
    WHERE updated_at > now() - interval '1 minute'
  `) as { n: number }[];
  if ((recent?.n ?? 0) >= 30) {
    return NextResponse.json({ error: "יותר מדי הרשמות כרגע. נסו שוב בעוד דקה." }, { status: 429 });
  }

  // Same person + institution again just refreshes the row instead of duplicating it.
  await sql`
    INSERT INTO coordinator_signups (first_name, last_name, institution_name, institution_kind)
    VALUES (${firstName}, ${lastName}, ${institutionName}, ${kind})
    ON CONFLICT (lower(first_name), lower(last_name), lower(institution_name)) DO UPDATE SET
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
