import type { SessionUser } from "./auth";
import { getSql } from "./db";

type Sql = ReturnType<typeof getSql>;

/** Nearest settlement name for a street centroid. */
export async function nearestSettlementName(
  sql: Sql,
  lat: number,
  lng: number,
): Promise<string | null> {
  const rows = (await sql`
    SELECT name_he
    FROM settlements
    ORDER BY (lat - ${lat}) ^ 2 + (lng - ${lng}) ^ 2
    LIMIT 1
  `) as { name_he: string }[];
  return rows[0]?.name_he ?? null;
}

/** Distinct settlement cities from groups linked to this coordinator. */
export async function coordinatorGroupCities(
  sql: Sql,
  coordinatorId: number,
): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT g.settlement_name AS name
    FROM groups g
    JOIN group_coordinators gc ON gc.group_id = g.id
    WHERE gc.user_id = ${coordinatorId}
      AND g.settlement_name IS NOT NULL
  `) as { name: string }[];
  return rows.map((r) => r.name);
}

export async function streetNearestCity(
  sql: Sql,
  streetId: string,
): Promise<{ lat: number; lng: number; city: string | null } | null> {
  const rows = (await sql`
    SELECT lat, lng FROM streets WHERE id = ${streetId} LIMIT 1
  `) as { lat: number; lng: number }[];
  const street = rows[0];
  if (!street) return null;
  const city = await nearestSettlementName(sql, street.lat, street.lng);
  return { lat: street.lat, lng: street.lng, city };
}

/**
 * When false, the caller sees every street.
 * When true, only streets whose ashkol is in `ashkols` are visible.
 * Stays off until some streets have ashkol AND the viewer has linked
 * clusters that already match at least one of those streets.
 */
export async function streetVisibilityFilter(
  sql: Sql,
  user: SessionUser,
): Promise<{ active: boolean; ashkols: string[] }> {
  if (user.role === "super_admin") {
    return { active: false, ashkols: [] };
  }

  const anyAshkol = (await sql`
    SELECT 1 AS ok FROM streets WHERE ashkol IS NOT NULL LIMIT 1
  `) as { ok: number }[];
  if (anyAshkol.length === 0) {
    return { active: false, ashkols: [] };
  }

  let ashkols: string[] = [];
  if (user.role === "coordinator") {
    if (!user.institution_id) {
      return { active: false, ashkols: [] };
    }
    const rows = (await sql`
      SELECT ashkol FROM institution_clusters
      WHERE institution_id = ${user.institution_id}
    `) as { ashkol: string }[];
    ashkols = rows.map((r) => r.ashkol);
  } else if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT ic.ashkol
      FROM institution_clusters ic
      JOIN users u ON u.institution_id = ic.institution_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { ashkol: string }[];
    ashkols = rows.map((r) => r.ashkol);
  }

  if (ashkols.length === 0) {
    return { active: false, ashkols: [] };
  }

  const matched = (await sql`
    SELECT 1 AS ok
    FROM streets
    WHERE ashkol = ANY(${ashkols})
    LIMIT 1
  `) as { ok: number }[];
  if (matched.length === 0) {
    return { active: false, ashkols };
  }

  return { active: true, ashkols };
}

export type AssignTarget = {
  id: number;
  full_name: string;
  institution_id: number | null;
};

/** Coordinators the caller may assign this street to (city + role rules). */
export async function allowedAssignTargets(
  sql: Sql,
  user: SessionUser,
  streetId: string,
): Promise<AssignTarget[]> {
  const loc = await streetNearestCity(sql, streetId);
  if (!loc?.city) return [];

  if (user.role === "super_admin") {
    return (await sql`
      SELECT id, full_name, institution_id
      FROM users
      WHERE role = 'coordinator'
      ORDER BY full_name
    `) as AssignTarget[];
  }

  if (user.role === "coordinator") {
    const cities = await coordinatorGroupCities(sql, user.id);
    if (!cities.includes(loc.city)) return [];
    return [
      {
        id: user.id,
        full_name: user.full_name,
        institution_id: user.institution_id,
      },
    ];
  }

  if (user.role === "area_manager") {
    const coords = (await sql`
      SELECT id, full_name, institution_id
      FROM users
      WHERE role = 'coordinator'
        AND manager_id = ${user.id}
        AND institution_id IS NOT NULL
      ORDER BY full_name
    `) as AssignTarget[];
    const out: AssignTarget[] = [];
    for (const c of coords) {
      const cities = await coordinatorGroupCities(sql, c.id);
      if (cities.includes(loc.city)) out.push(c);
    }
    return out;
  }

  return [];
}

export async function canAssignStreetTo(
  sql: Sql,
  user: SessionUser,
  streetId: string,
  targetUserId: number,
): Promise<boolean> {
  const targets = await allowedAssignTargets(sql, user, streetId);
  return targets.some((t) => t.id === targetUserId);
}

export async function canManageInstitutionCluster(
  sql: Sql,
  user: SessionUser,
  institutionId: number,
): Promise<boolean> {
  if (user.role === "super_admin") return true;
  if (user.role === "coordinator") {
    return user.institution_id === institutionId;
  }
  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT 1 AS ok
      FROM users
      WHERE role = 'coordinator'
        AND manager_id = ${user.id}
        AND institution_id = ${institutionId}
      LIMIT 1
    `) as { ok: number }[];
    return rows.length > 0;
  }
  return false;
}
