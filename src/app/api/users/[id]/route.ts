import { NextRequest, NextResponse } from "next/server";
import {
  getSessionUser,
  hashPassword,
  requireRole,
  type SessionUser,
} from "@/lib/auth";
import { getSql } from "@/lib/db";
import { mobileMatchVariants, normalizeMobileLocal } from "@/lib/mobile";
import { validatePassword } from "@/lib/passwords";
import { syncPrimaryInstitution } from "@/lib/streets-access";
import { replaceAreaManagerCoordinators } from "@/lib/user-links";

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
    institution_ids?: number[];
    coordinator_ids?: number[];
    settlement_name?: string | null;
    manager_id?: number | null;
  };

  const full_name = body.full_name?.trim() ?? "";
  let email = body.email?.trim().toLowerCase() ?? "";
  const mobileNorm = normalizeMobileLocal(body.mobile ?? "");
  const password = body.password?.trim() ?? "";

  if (!full_name || !mobileNorm) {
    return NextResponse.json({ error: "שם ונייד חובה" }, { status: 400 });
  }
  if (!email) email = `${mobileNorm}@users.local`;

  let role = body.role ?? target.role;
  const hasInstitutionIds = Array.isArray(body.institution_ids);
  const institutionIds = hasInstitutionIds
    ? [
        ...new Set(
          body.institution_ids!
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ]
    : null;
  const hasCoordinatorIds = Array.isArray(body.coordinator_ids);
  const coordinatorIds = hasCoordinatorIds
    ? [
        ...new Set(
          body.coordinator_ids!
            .map((n) => Number(n))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ]
    : null;
  let institution_id =
    institutionIds != null
      ? (institutionIds[0] ?? null)
      : body.institution_id !== undefined
        ? body.institution_id
        : target.institution_id;
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

  const sql = getSql();

  if (target.role === "super_admin" && role !== "super_admin") {
    const [count] = (await sql`
      SELECT count(*)::int AS n FROM users WHERE role = 'super_admin'
    `) as { n: number }[];
    if ((count?.n ?? 0) <= 1) {
      return NextResponse.json(
        { error: "לא ניתן להוריד את מנהל העל האחרון" },
        { status: 400 },
      );
    }
  }

  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  }

  const mobileVariants = mobileMatchVariants(mobileNorm);
  const [dup] = (await sql`
    SELECT id FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${mobileVariants})
      AND id <> ${id}
    LIMIT 1
  `) as { id: number }[];
  if (dup) {
    return NextResponse.json(
      { error: "מספר נייד כבר משויך למשתמש אחר" },
      { status: 409 },
    );
  }

  try {
    let row: Record<string, unknown> | undefined;
    if (password) {
      const hash = hashPassword(password);
      [row] = await sql`
        UPDATE users SET
          full_name = ${full_name},
          mobile = ${mobileNorm},
          email = ${email},
          password_hash = ${hash},
          role = ${role},
          institution_id = ${institution_id},
          manager_id = ${manager_id},
          settlement_name = ${settlement_name}
        WHERE id = ${id}
        RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                  settlement_name
      `;
    } else {
      [row] = await sql`
        UPDATE users SET
          full_name = ${full_name},
          mobile = ${mobileNorm},
          email = ${email},
          role = ${role},
          institution_id = ${institution_id},
          manager_id = ${manager_id},
          settlement_name = ${settlement_name}
        WHERE id = ${id}
        RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                  settlement_name
      `;
    }

    if (role === "coordinator" && institutionIds != null) {
      await sql`DELETE FROM institution_coordinators WHERE user_id = ${id}`;
      for (const institutionId of institutionIds) {
        await sql`
          INSERT INTO institution_coordinators (institution_id, user_id, linked_by)
          VALUES (${institutionId}, ${id}, ${user!.id})
          ON CONFLICT DO NOTHING
        `;
      }
      const primary = await syncPrimaryInstitution(sql, id);
      if (row) row.institution_id = primary;
    } else if (role === "coordinator" && body.institution_id !== undefined && institution_id) {
      // Legacy single-id add (does not clear other links).
      await sql`
        INSERT INTO institution_coordinators (institution_id, user_id, linked_by)
        VALUES (${institution_id}, ${id}, ${user!.id})
        ON CONFLICT DO NOTHING
      `;
      await syncPrimaryInstitution(sql, id);
    } else if (role !== "coordinator") {
      await sql`DELETE FROM institution_coordinators WHERE user_id = ${id}`;
      await sql`UPDATE users SET institution_id = NULL WHERE id = ${id}`;
      if (row) row.institution_id = null;
    }

    if (role === "area_manager" && coordinatorIds != null) {
      await replaceAreaManagerCoordinators(sql, id, coordinatorIds);
    } else if (role !== "area_manager" && target.role === "area_manager") {
      // Demoted from area manager — detach former reports.
      await replaceAreaManagerCoordinators(sql, id, []);
    }

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
