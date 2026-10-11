import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { mobileMatchVariants, normalizeMobileLocal } from "@/lib/mobile";
import { validatePassword } from "@/lib/passwords";
import { syncPrimaryInstitution } from "@/lib/streets-access";
import { replaceAreaManagerCoordinators } from "@/lib/user-links";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sql = getSql();

  if (user.role === "super_admin") {
    const rows = await sql`
      SELECT u.id, u.full_name, u.mobile, u.email, u.role, u.institution_id,
             u.manager_id, u.settlement_name,
             i.name AS institution_name,
             m.full_name AS manager_name,
             coalesce(
               (
                 SELECT string_agg(inst.name, ' · ' ORDER BY inst.name)
                 FROM institution_coordinators link
                 JOIN institutions inst ON inst.id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               i.name
             ) AS institution_names,
             coalesce(
               (
                 SELECT json_agg(link.institution_id ORDER BY inst.name)
                 FROM institution_coordinators link
                 JOIN institutions inst ON inst.id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               '[]'
             ) AS institution_ids,
             coalesce(
               (
                 SELECT string_agg(c.full_name, ' · ' ORDER BY c.full_name)
                 FROM users c
                 WHERE c.manager_id = u.id AND c.role = 'coordinator'
               ),
               NULL
             ) AS coordinator_names,
             coalesce(
               (
                 SELECT json_agg(c.id ORDER BY c.full_name)
                 FROM users c
                 WHERE c.manager_id = u.id AND c.role = 'coordinator'
               ),
               '[]'
             ) AS coordinator_ids
      FROM users u
      LEFT JOIN institutions i ON i.id = u.institution_id
      LEFT JOIN users m ON m.id = u.manager_id
      ORDER BY u.role, u.full_name
    `;
    return NextResponse.json({ users: rows });
  }

  if (user.role === "area_manager") {
    const rows = await sql`
      SELECT u.id, u.full_name, u.mobile, u.email, u.role, u.institution_id,
             u.manager_id, u.settlement_name,
             i.name AS institution_name,
             coalesce(
               (
                 SELECT string_agg(inst.name, ' · ' ORDER BY inst.name)
                 FROM institution_coordinators link
                 JOIN institutions inst ON inst.id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               i.name
             ) AS institution_names,
             coalesce(
               (
                 SELECT json_agg(link.institution_id ORDER BY inst.name)
                 FROM institution_coordinators link
                 JOIN institutions inst ON inst.id = link.institution_id
                 WHERE link.user_id = u.id
               ),
               '[]'
             ) AS institution_ids
      FROM users u
      LEFT JOIN institutions i ON i.id = u.institution_id
      WHERE u.manager_id = ${user.id}
      ORDER BY u.full_name
    `;
    return NextResponse.json({ users: rows });
  }

  return NextResponse.json({ users: [user] });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
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
  const password = body.password ?? "";
  const mobileNorm = normalizeMobileLocal(body.mobile ?? "");
  let email = body.email?.trim().toLowerCase() ?? "";
  let role = body.role ?? "coordinator";
  const institutionIds = normalizeInstitutionIds(
    body.institution_ids,
    body.institution_id,
  );
  const coordinatorIds = normalizeIdList(body.coordinator_ids);
  let institution_id = institutionIds[0] ?? body.institution_id ?? null;
  let settlement_name = body.settlement_name?.trim() || null;
  let manager_id = body.manager_id ?? null;

  if (!full_name || !mobileNorm || !password) {
    return NextResponse.json({ error: "שם, נייד וסיסמה חובה" }, { status: 400 });
  }
  if (!email) email = `${mobileNorm}@users.local`;

  const pwErr = validatePassword(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  if (user!.role === "area_manager") {
    role = "coordinator";
    manager_id = user!.id;
  }

  if (!["super_admin", "area_manager", "coordinator"].includes(role)) {
    return NextResponse.json({ error: "תפקיד לא חוקי" }, { status: 400 });
  }

  const sql = getSql();
  const mobileVariants = mobileMatchVariants(mobileNorm);
  const [dup] = (await sql`
    SELECT id FROM users
    WHERE regexp_replace(coalesce(mobile, ''), '[^0-9]', '', 'g') = ANY(${mobileVariants})
    LIMIT 1
  `) as { id: number }[];
  if (dup) {
    return NextResponse.json(
      { error: "מספר נייד כבר משויך למשתמש אחר" },
      { status: 409 },
    );
  }

  // settlement_name is optional / legacy; not required for coordinators.
  const hash = hashPassword(password);
  try {
    const [row] = (await sql`
      INSERT INTO users (
        full_name, mobile, email, password_hash, role,
        institution_id, manager_id, settlement_name
      ) VALUES (
        ${full_name}, ${mobileNorm}, ${email}, ${hash}, ${role},
        ${institution_id}, ${manager_id}, ${settlement_name}
      )
      RETURNING id, full_name, mobile, email, role, institution_id, manager_id,
                settlement_name
    `) as { id: number; institution_id: number | null }[];
    if (row && role === "coordinator") {
      await replaceUserInstitutions(sql, row.id, user!.id, institutionIds);
      const primary = await syncPrimaryInstitution(sql, row.id);
      return NextResponse.json({
        user: { ...row, institution_id: primary },
      });
    }
    if (row && role === "area_manager" && Array.isArray(body.coordinator_ids)) {
      await replaceAreaManagerCoordinators(sql, row.id, coordinatorIds);
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

function normalizeIdList(ids: number[] | undefined): number[] {
  return [
    ...new Set(
      (ids ?? [])
        .map((n) => Number(n))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
}

function normalizeInstitutionIds(
  ids: number[] | undefined,
  legacy: number | null | undefined,
): number[] {
  const fromArray = normalizeIdList(ids);
  if (fromArray.length > 0) return fromArray;
  if (legacy != null && Number.isInteger(Number(legacy)) && Number(legacy) > 0) {
    return [Number(legacy)];
  }
  return [];
}

async function replaceUserInstitutions(
  sql: ReturnType<typeof getSql>,
  userId: number,
  actorId: number,
  institutionIds: number[],
) {
  await sql`DELETE FROM institution_coordinators WHERE user_id = ${userId}`;
  for (const institutionId of institutionIds) {
    await sql`
      INSERT INTO institution_coordinators (institution_id, user_id, linked_by)
      VALUES (${institutionId}, ${userId}, ${actorId})
      ON CONFLICT DO NOTHING
    `;
  }
}

