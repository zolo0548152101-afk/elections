import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

/** Assign coordinators under an area manager via users.manager_id. */
export async function replaceAreaManagerCoordinators(
  sql: Sql,
  managerId: number,
  coordinatorIds: number[],
) {
  await sql`
    UPDATE users
    SET manager_id = NULL
    WHERE manager_id = ${managerId}
      AND role = 'coordinator'
      AND NOT (id = ANY(${coordinatorIds}))
  `;
  if (coordinatorIds.length === 0) return;
  await sql`
    UPDATE users
    SET manager_id = ${managerId}
    WHERE role = 'coordinator'
      AND id = ANY(${coordinatorIds})
  `;
}
