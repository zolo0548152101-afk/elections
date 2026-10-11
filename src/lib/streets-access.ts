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

/** Distinct settlement cities from the coordinator's institution + legacy groups. */
export async function coordinatorGroupCities(
  sql: Sql,
  coordinatorId: number,
): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT name FROM (
      SELECT i.settlement_name AS name
      FROM users u
      JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = ${coordinatorId}
        AND i.settlement_name IS NOT NULL
      UNION
      SELECT g.settlement_name AS name
      FROM groups g
      JOIN group_coordinators gc ON gc.group_id = g.id
      WHERE gc.user_id = ${coordinatorId}
        AND g.settlement_name IS NOT NULL
    ) cities
  `) as { name: string }[];
  return rows.map((r) => r.name);
}

/**
 * Ashkols the viewer may see as voter clusters on the map/table.
 * `null` = unrestricted (super_admin). Empty = none.
 * Coordinators: only ashkols linked to their institution.
 */
export async function visibleClusterAshkols(
  sql: Sql,
  user: SessionUser,
): Promise<string[] | null> {
  if (user.role === "super_admin") return null;

  if (user.role === "coordinator") {
    if (!user.institution_id) return [];
    const rows = (await sql`
      SELECT ashkol FROM institution_clusters
      WHERE institution_id = ${user.institution_id}
    `) as { ashkol: string }[];
    return rows.map((r) => r.ashkol);
  }

  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT ic.ashkol
      FROM institution_clusters ic
      JOIN users u ON u.institution_id = ic.institution_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { ashkol: string }[];
    return rows.map((r) => r.ashkol);
  }

  return [];
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

  // Once the viewer has linked clusters (and streets have ashkol data), always scope.
  if (ashkols.length === 0) {
    return { active: false, ashkols: [] };
  }

  return { active: true, ashkols };
}

/** Whether the user may view/mark this ashkol's streets. */
export async function canAccessAshkol(
  sql: Sql,
  user: SessionUser,
  ashkol: string,
): Promise<boolean> {
  if (user.role === "super_admin") return true;
  // Cluster list/link scope: only institution-linked ashkols for non-admins.
  const linked = await visibleClusterAshkols(sql, user);
  if (linked !== null) {
    return linked.includes(ashkol);
  }
  return true;
}

/**
 * Whether the user may mark this street done.
 * Super admin: yes. Coordinator: assigned to them OR nearest city in their group cities.
 * Area manager: street city in any of their coordinators' group cities.
 */
export async function canMarkStreet(
  sql: Sql,
  user: SessionUser,
  streetId: string,
): Promise<boolean> {
  if (user.role === "super_admin") return true;

  const loc = await streetNearestCity(sql, streetId);
  if (!loc?.city) return false;

  const assigned = (await sql`
    SELECT 1 AS ok FROM street_coordinators
    WHERE street_id = ${streetId} AND user_id = ${user.id}
    LIMIT 1
  `) as { ok: number }[];
  if (assigned.length > 0) return true;

  if (user.role === "coordinator") {
    const cities = await coordinatorGroupCities(sql, user.id);
    if (cities.includes(loc.city)) return true;
    // Fallback: user's own settlement_name
    if (user.settlement_name && user.settlement_name === loc.city) return true;
    return false;
  }

  if (user.role === "area_manager") {
    const coords = (await sql`
      SELECT id FROM users
      WHERE role = 'coordinator' AND manager_id = ${user.id}
    `) as { id: number }[];
    for (const c of coords) {
      const cities = await coordinatorGroupCities(sql, c.id);
      if (cities.includes(loc.city)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Coordinator may only link clusters whose settlement is in their group cities
 * (or their user settlement). Super admin: any. Area manager: settlements of team.
 */
export async function canLinkClusterAshkol(
  sql: Sql,
  user: SessionUser,
  ashkol: string,
): Promise<boolean> {
  if (user.role === "super_admin") return true;

  const cluster = (await sql`
    SELECT settlement_name FROM clusters WHERE ashkol = ${ashkol} LIMIT 1
  `) as { settlement_name: string }[];
  if (!cluster[0]) return false;
  const settlement = cluster[0].settlement_name;

  if (user.role === "coordinator") {
    const cities = await coordinatorGroupCities(sql, user.id);
    if (cities.includes(settlement)) return true;
    return user.settlement_name === settlement;
  }

  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT COALESCE(g.settlement_name, u.settlement_name) AS name
      FROM users u
      LEFT JOIN group_coordinators gc ON gc.user_id = u.id
      LEFT JOIN groups g ON g.id = gc.group_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { name: string | null }[];
    return rows.some((r) => r.name === settlement);
  }

  return false;
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
    if (!cities.includes(loc.city) && user.settlement_name !== loc.city) {
      return [];
    }
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
