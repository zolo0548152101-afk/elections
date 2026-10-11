import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

/** Link or unlink a coordinator user to this institution (sets users.institution_id). */
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

  const [row] = await sql`
    UPDATE users
    SET institution_id = ${institutionId}
    WHERE id = ${userId}
    RETURNING id, full_name, email, institution_id
  `;

  return NextResponse.json({ user: row });
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
    SELECT id, role, manager_id, institution_id
    FROM users WHERE id = ${userId} LIMIT 1
  `) as {
    id: number;
    role: string;
    manager_id: number | null;
    institution_id: number | null;
  }[];

  if (!target || target.institution_id !== institutionId) {
    return NextResponse.json({ error: "הרכז לא משויך למוסד זה" }, { status: 404 });
  }
  if (user!.role === "area_manager" && target.manager_id !== user!.id) {
    return NextResponse.json({ error: "רכז מחוץ לצוות" }, { status: 403 });
  }

  await sql`
    UPDATE users SET institution_id = NULL WHERE id = ${userId}
  `;

  return NextResponse.json({ ok: true });
}
