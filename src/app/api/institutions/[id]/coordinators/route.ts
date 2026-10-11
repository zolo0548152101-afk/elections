import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { syncPrimaryInstitution } from "@/lib/streets-access";

export const runtime = "nodejs";

/** Link a coordinator to this institution (many-to-many; does not clear other links). */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const institutionId = Number((await ctx.params).id);
  if (!Number.isInteger(institutionId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const body = (await req.json()) as { user_id?: number };
  const userId = Number(body.user_id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "user_id חסר" }, { status: 400 });
  }

  const sql = getSql();
  const [inst] = (await sql`
    SELECT id FROM institutions WHERE id = ${institutionId} LIMIT 1
  `) as { id: number }[];
  if (!inst) {
    return NextResponse.json({ error: "מוסד לא נמצא" }, { status: 404 });
  }

  const [target] = (await sql`
    SELECT id, role, manager_id FROM users WHERE id = ${userId} LIMIT 1
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

  await sql`
    INSERT INTO institution_coordinators (institution_id, user_id, linked_by)
    VALUES (${institutionId}, ${userId}, ${user!.id})
    ON CONFLICT DO NOTHING
  `;
  const primary = await syncPrimaryInstitution(sql, userId);

  return NextResponse.json({
    ok: true,
    user: { id: userId, institution_id: primary },
  });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const institutionId = Number((await ctx.params).id);
  if (!Number.isInteger(institutionId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const userId = Number(req.nextUrl.searchParams.get("user_id"));
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "user_id חסר" }, { status: 400 });
  }

  const sql = getSql();
  const [target] = (await sql`
    SELECT u.id, u.role, u.manager_id,
           EXISTS (
             SELECT 1 FROM institution_coordinators ic
             WHERE ic.institution_id = ${institutionId} AND ic.user_id = u.id
           ) AS linked
    FROM users u WHERE u.id = ${userId} LIMIT 1
  `) as {
    id: number;
    role: string;
    manager_id: number | null;
    linked: boolean;
  }[];

  if (!target || !target.linked) {
    return NextResponse.json({ error: "הרכז לא משויך למוסד זה" }, { status: 404 });
  }
  if (user!.role === "area_manager" && target.manager_id !== user!.id) {
    return NextResponse.json({ error: "רכז מחוץ לצוות" }, { status: 403 });
  }

  await sql`
    DELETE FROM institution_coordinators
    WHERE institution_id = ${institutionId} AND user_id = ${userId}
  `;
  await syncPrimaryInstitution(sql, userId);

  return NextResponse.json({ ok: true });
}
