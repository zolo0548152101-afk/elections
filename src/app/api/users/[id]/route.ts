import { NextRequest, NextResponse } from "next/server";
import {
  getSessionUser,
  hashPassword,
  requireRole,
  type SessionUser,
} from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type TargetUser = {
  id: number;
  role: string;
  manager_id: number | null;
  institution_id: number | null;
  settlement_name: string | null;
};

async function loadTarget(targetId: number): Promise<TargetUser | null> {
  const sql = getSql();
  const rows = (await sql`
    SELECT id, role, manager_id, institution_id, settlement_name
    FROM users WHERE id = ${targetId} LIMIT 1
  `) as TargetUser[];
  return rows[0] ?? null;
}

function canManage(actor: SessionUser, target: TargetUser) {
  if (actor.role === "super_admin") return true;
  if (actor.role === "area_manager") {
    return target.role === "coordinator" && target.manager_id === actor.id;
  }
  return false;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const target = await loadTarget(id);
  if (!target || !canManage(user!, target)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    full_name?: string;
    mobile?: string;
    email?: string;
    password?: string;
    role?: string;
    institution_id?: number | null;
    settlement_name?: string | null;
    manager_id?: number | null;
  };

  const full_name = body.full_name?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";
  const mobile = body.mobile?.trim() ?? "";
  const password = body.password?.trim() ?? "";

  if (!full_name || !email) {
    return NextResponse.json({ error: "שם ואימייל חובה" }, { status: 400 });
  }

  let role = body.role ?? target.role;
  let institution_id =
    body.institution_id !== undefined ? body.institution_id : target.institution_id;
  let settlement_name =
    body.settlement_name !== undefined
      ? body.settlement_name?.trim() || null
      : target.settlement_name;
  let manager_id =
    body.manager_id !== undefined ? body.manager_id : target.manager_id;

  if (user!.role === "area_manager") {
    role = "coordinator";
    manager_id = user!.id;
  }

  if (!["super_admin", "area_manager", "coordinator"].includes(role)) {
    return NextResponse.json({ error: "תפקיד לא חוקי" }, { status: 400 });
  }

  if (role === "coordinator" && !settlement_name) {
    return NextResponse.json({ error: "לרכז חובה לבחור יישוב" }, { status: 400 });
  }

  const sql = getSql();
  if (settlement_name) {
    const [known] = (await sql`
      SELECT name_he FROM settlements WHERE name_he = ${settlement_name} LIMIT 1
    `) as { name_he: string }[];
    if (!known) {
      return NextResponse.json(
        { error: "יישוב לא נמצא ברשימת היישובים" },
        { status: 400 },
      );
    }
  }

  try {
    if (password) {
      const hash = hashPassword(password);
      const [row] = await sql`
        UPDATE users SET
          full_name = ${full_name},
          mobile = ${mobile},
          email = ${email},
          password_hash = ${hash},
          login_password = ${password},
          role = ${role},
          institution_id = ${institution_id},
          manager_id = ${manager_id},
          settlement_name = ${settlement_name}
        WHERE id = ${id}
        RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                  settlement_name, login_password
      `;
      return NextResponse.json({ user: row });
    }

    const [row] = await sql`
      UPDATE users SET
        full_name = ${full_name},
        mobile = ${mobile},
        email = ${email},
        role = ${role},
        institution_id = ${institution_id},
        manager_id = ${manager_id},
        settlement_name = ${settlement_name}
      WHERE id = ${id}
      RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                settlement_name, login_password
    `;
    return NextResponse.json({ user: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "אימייל כבר קיים" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  if (id === user!.id) {
    return NextResponse.json(
      { error: "לא ניתן למחוק את המשתמש המחובר" },
      { status: 400 },
    );
  }

  const target = await loadTarget(id);
  if (!target || !canManage(user!, target)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  if (target.role === "super_admin") {
    const [count] = (await sql`
      SELECT count(*)::int AS n FROM users WHERE role = 'super_admin'
    `) as { n: number }[];
    if ((count?.n ?? 0) <= 1) {
      return NextResponse.json(
        { error: "לא ניתן למחוק את מנהל העל האחרון" },
        { status: 400 },
      );
    }
  }

  await sql`DELETE FROM sessions WHERE user_id = ${id}`;
  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
