import type { SessionUser } from "@/lib/auth";
import type { getSql } from "@/lib/db";
import { coordinatorInstitutionIds } from "@/lib/streets-access";

type Sql = ReturnType<typeof getSql>;

/**
 * Institutions whose activists this user may see and change.
 * `null` = all (admin). Empty array = none.
 */
export async function activistInstitutionScope(sql: Sql, user: SessionUser): Promise<number[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "coordinator") return coordinatorInstitutionIds(sql, user.id);
  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT link.institution_id AS id
      FROM institution_coordinators link
      JOIN users u ON u.id = link.user_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { id: number }[];
    return rows.map((row) => row.id);
  }
  return [];
}
