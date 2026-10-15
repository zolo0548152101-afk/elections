import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { cleanSignupText, isCoordinatorSignupKind } from "@/lib/coordinator-signups";
import { normalizeMobileLocal } from "@/lib/mobile";

export const runtime = "nodejs";

async function adminOnly() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (user.role !== "super_admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Edit a coordinator sign-up (admin). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const firstName = cleanSignupText(String(body.first_name ?? ""), 40);
  const lastName = cleanSignupText(String(body.last_name ?? ""), 40);
  const mobile = normalizeMobileLocal(String(body.mobile ?? ""));
  const institutionName = cleanSignupText(String(body.institution_name ?? ""), 80);
  const kind = String(body.institution_kind ?? "");
  if (!firstName) return NextResponse.json({ error: "כתבו שם פרטי" }, { status: 400 });
  if (!lastName) return NextResponse.json({ error: "כתבו שם משפחה" }, { status: 400 });
  if (!mobile) return NextResponse.json({ error: "נייד לא תקין" }, { status: 400 });
  if (!isCoordinatorSignupKind(kind)) return NextResponse.json({ error: "בחרו סוג מוסד" }, { status: 400 });
  if (!institutionName) return NextResponse.json({ error: "כתבו שם מוסד" }, { status: 400 });

  const sql = getSql();
  try {
    const [row] = await sql`
      UPDATE coordinator_signups
      SET first_name = ${firstName}, last_name = ${lastName}, mobile = ${mobile},
          institution_name = ${institutionName}, institution_kind = ${kind}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, first_name, last_name, mobile, institution_name, institution_kind, created_at, updated_at
    `;
    if (!row) return NextResponse.json({ error: "ההרשמה לא נמצאה" }, { status: 404 });
    return NextResponse.json({ signup: row });
  } catch (err) {
    if (String((err as { code?: string }).code) === "23505") {
      return NextResponse.json({ error: "הנייד הזה כבר רשום" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await adminOnly();
  if (denied) return denied;
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  const sql = getSql();
  await sql`DELETE FROM coordinator_signups WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
