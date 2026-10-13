import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { coordinatorInstitutionIds } from "@/lib/streets-access";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sql = getSql();
  let institutionIds: number[] | null = null;
  if (user.role === "coordinator") {
    institutionIds = await coordinatorInstitutionIds(sql, user.id);
  } else if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT link.institution_id AS id
      FROM institution_coordinators link
      JOIN users u ON u.id = link.user_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { id: number }[];
    institutionIds = rows.map((row) => row.id);
  } else if (user.role !== "super_admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scope =
    user.role === "coordinator"
      ? "coordinator"
      : user.role === "area_manager"
        ? "manager"
        : "admin";

  const hasInstitutions = institutionIds === null || institutionIds.length > 0;
  if (institutionIds && institutionIds.length === 0) {
    return NextResponse.json({ activists: [], institutions: [], scope, hasInstitutions: false });
  }

  const activists = (institutionIds
    ? await sql`
        SELECT a.id, a.full_name, a.mobile, a.shirt_size, a.created_at, a.updated_at,
               i.id AS institution_id, i.name AS institution_name, i.settlement_name
        FROM activists a
        JOIN institutions i ON i.id = a.institution_id
        WHERE a.institution_id = ANY(${institutionIds})
        ORDER BY i.name, a.created_at DESC
      `
    : await sql`
        SELECT a.id, a.full_name, a.mobile, a.shirt_size, a.created_at, a.updated_at,
               i.id AS institution_id, i.name AS institution_name, i.settlement_name
        FROM activists a
        JOIN institutions i ON i.id = a.institution_id
        ORDER BY i.name, a.created_at DESC
      `) as {
    id: number;
    full_name: string;
    mobile: string;
    shirt_size: string;
    created_at: string;
    updated_at: string;
    institution_id: number;
    institution_name: string;
    settlement_name: string | null;
  }[];

  const institutions = (institutionIds
    ? await sql`
        SELECT i.id, i.name, i.settlement_name
        FROM institutions i
        WHERE i.id = ANY(${institutionIds})
          AND EXISTS (
            SELECT 1 FROM activists a WHERE a.institution_id = i.id
          )
        ORDER BY i.name
      `
    : await sql`
        SELECT DISTINCT i.id, i.name, i.settlement_name
        FROM institutions i
        JOIN activists a ON a.institution_id = i.id
        ORDER BY i.name
      `) as { id: number; name: string; settlement_name: string | null }[];

  return NextResponse.json({ activists, institutions, scope, hasInstitutions });
}
