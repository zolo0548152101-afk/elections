import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { cleanActivistName, isShirtSize } from "@/lib/activists";
import { activistInstitutionScope } from "@/lib/activists-scope";
import { normalizeMobileLocal } from "@/lib/mobile";

export const runtime = "nodejs";

async function loadAllowed(id: number) {
  const user = await getSessionUser();
  if (!user) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const sql = getSql();
  const [row] = (await sql`SELECT id, institution_id FROM activists WHERE id = ${id}`) as {
    id: number;
    institution_id: number;
  }[];
  if (!row) return { error: NextResponse.json({ error: "הפעיל לא נמצא" }, { status: 404 }) };
  const scope = await activistInstitutionScope(sql, user);
  if (scope && !scope.includes(row.institution_id)) {
    return { error: NextResponse.json({ error: "אין הרשאה לפעיל זה" }, { status: 403 }) };
  }
  return { sql, row };
}

function parseId(raw: string) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Edit an activist: name, mobile, shirt size. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  const found = await loadAllowed(id);
  if ("error" in found) return found.error;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const fullName = cleanActivistName(String(body.full_name ?? ""));
  const mobile = normalizeMobileLocal(String(body.mobile ?? ""));
  const shirt = String(body.shirt_size ?? "");
  if (!fullName) return NextResponse.json({ error: "כתבו שם מלא" }, { status: 400 });
  if (!mobile) return NextResponse.json({ error: "נייד לא תקין" }, { status: 400 });
  if (!isShirtSize(shirt)) return NextResponse.json({ error: "בחרו מידת חולצה" }, { status: 400 });

  try {
    const [row] = await found.sql`
      UPDATE activists
      SET full_name = ${fullName}, mobile = ${mobile}, shirt_size = ${shirt}, updated_at = now()
      WHERE id = ${id}
      RETURNING id, full_name, mobile, shirt_size, updated_at
    `;
    return NextResponse.json({ activist: row });
  } catch (err) {
    if (String((err as { code?: string }).code) === "23505") {
      return NextResponse.json({ error: "הנייד הזה כבר רשום במוסד הזה" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = parseId((await ctx.params).id);
  if (!id) return NextResponse.json({ error: "מזהה לא תקין" }, { status: 400 });
  const found = await loadAllowed(id);
  if ("error" in found) return found.error;
  await found.sql`DELETE FROM activists WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
