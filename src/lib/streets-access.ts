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

/** Institution ids linked to a coordinator (join table + legacy FK). */
export async function coordinatorInstitutionIds(
  sql: Sql,
  coordinatorId: number,
): Promise<number[]> {
  const rows = (await sql`
    SELECT DISTINCT institution_id AS id FROM (
      SELECT ic.institution_id
      FROM institution_coordinators ic
      WHERE ic.user_id = ${coordinatorId}
      UNION
      SELECT u.institution_id
      FROM users u
      WHERE u.id = ${coordinatorId}
        AND u.institution_id IS NOT NULL
    ) x
  `) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Settlement cities from the coordinator's linked institutions (+ user settlement). */
export async function coordinatorInstitutionCities(
  sql: Sql,
  coordinatorId: number,
): Promise<string[]> {
  const rows = (await sql`
    SELECT DISTINCT name FROM (
      SELECT i.settlement_name AS name
      FROM institution_coordinators ic
      JOIN institutions i ON i.id = ic.institution_id
      WHERE ic.user_id = ${coordinatorId}
        AND i.settlement_name IS NOT NULL
      UNION
      SELECT i.settlement_name AS name
      FROM users u
      JOIN institutions i ON i.id = u.institution_id
      WHERE u.id = ${coordinatorId}
        AND i.settlement_name IS NOT NULL
      UNION
      SELECT u.settlement_name AS name
      FROM users u
      WHERE u.id = ${coordinatorId}
        AND u.settlement_name IS NOT NULL
    ) cities
  `) as { name: string }[];
  return rows.map((r) => r.name);
}

/** @deprecated use coordinatorInstitutionCities */
export const coordinatorGroupCities = coordinatorInstitutionCities;

/**
 * Ashkols the viewer may see as voter clusters on the map/table.
 * `null` = unrestricted (super_admin). Empty = none.
 * Coordinators: ashkols linked to any of their institutions.
 */
export async function visibleClusterAshkols(
  sql: Sql,
  user: SessionUser,
): Promise<string[] | null> {
  if (user.role === "super_admin") return null;

  if (user.role === "coordinator") {
    const ids = await coordinatorInstitutionIds(sql, user.id);
    if (ids.length === 0) return [];
    const rows = (await sql`
      SELECT DISTINCT ashkol FROM institution_clusters
      WHERE institution_id = ANY(${ids})
    `) as { ashkol: string }[];
    return rows.map((r) => r.ashkol);
  }

  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT ic.ashkol
      FROM institution_clusters ic
      JOIN institution_coordinators link ON link.institution_id = ic.institution_id
      JOIN users u ON u.id = link.user_id
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

  const linked = await visibleClusterAshkols(sql, user);
  const ashkols = linked ?? [];

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
  const linked = await visibleClusterAshkols(sql, user);
  if (linked !== null) {
    return linked.includes(ashkol);
  }
  return true;
}

/**
 * Whether the user may mark this street done.
 * Super admin: yes. Anyone: the street is linked to one of their clusters.
 * Coordinator: also assigned OR nearest city in institution cities.
 * Area manager: street city in any of their coordinators' institution cities.
 */
export async function canMarkStreet(
  sql: Sql,
  user: SessionUser,
  streetId: string,
): Promise<boolean> {
  if (user.role === "super_admin") return true;

  // A street linked to one of the user's clusters can always be marked
  // (the cluster street list offers exactly these lines).
  const visible = await visibleClusterAshkols(sql, user);
  if (visible && visible.length > 0) {
    const linked = (await sql`
      SELECT 1 AS ok
      WHERE EXISTS (
        SELECT 1 FROM eshkol_osm_streets
        WHERE street_id = ${streetId} AND ashkol = ANY(${visible})
      ) OR EXISTS (
        SELECT 1 FROM streets
        WHERE id = ${streetId} AND ashkol = ANY(${visible})
      )
    `) as { ok: number }[];
    if (linked.length > 0) return true;
  }

  const loc = await streetNearestCity(sql, streetId);
  if (!loc?.city) return false;

  const assigned = (await sql`
    SELECT 1 AS ok FROM street_coordinators
    WHERE street_id = ${streetId} AND user_id = ${user.id}
    LIMIT 1
  `) as { ok: number }[];
  if (assigned.length > 0) return true;

  if (user.role === "coordinator") {
    const cities = await coordinatorInstitutionCities(sql, user.id);
    return cities.includes(loc.city);
  }

  if (user.role === "area_manager") {
    const coords = (await sql`
      SELECT id FROM users
      WHERE role = 'coordinator' AND manager_id = ${user.id}
    `) as { id: number }[];
    for (const c of coords) {
      const cities = await coordinatorInstitutionCities(sql, c.id);
      if (cities.includes(loc.city)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Settlements whose clusters this user may link.
 * `null` means every settlement (super admin).
 */
export async function linkableSettlementNames(
  sql: Sql,
  user: SessionUser,
): Promise<string[] | null> {
  if (user.role === "super_admin") return null;
  if (user.role === "coordinator") {
    return coordinatorInstitutionCities(sql, user.id);
  }
  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT name FROM (
        SELECT i.settlement_name AS name
        FROM users u
        JOIN institution_coordinators link ON link.user_id = u.id
        JOIN institutions i ON i.id = link.institution_id
        WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
          AND i.settlement_name IS NOT NULL
        UNION
        SELECT u.settlement_name AS name
        FROM users u
        WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
          AND u.settlement_name IS NOT NULL
      ) cities
    `) as { name: string | null }[];
    return rows.map((r) => r.name).filter((name): name is string => Boolean(name));
  }
  return [];
}

/**
 * Coordinator may only link clusters in their institution city (or user settlement).
 * Super admin: any. Area manager: settlements of team institutions.
 */
export async function canLinkClusterAshkol(
  sql: Sql,
  user: SessionUser,
  ashkol: string,
): Promise<boolean> {
  const names = await linkableSettlementNames(sql, user);
  if (names === null) return true;

  const cluster = (await sql`
    SELECT settlement_name FROM clusters WHERE ashkol = ${ashkol} LIMIT 1
  `) as { settlement_name: string }[];
  if (!cluster[0]) return false;
  return names.includes(cluster[0].settlement_name);
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
    const cities = await coordinatorInstitutionCities(sql, user.id);
    if (!cities.includes(loc.city)) {
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
      SELECT DISTINCT u.id, u.full_name, u.institution_id
      FROM users u
      JOIN institution_coordinators link ON link.user_id = u.id
      WHERE u.role = 'coordinator'
        AND u.manager_id = ${user.id}
      ORDER BY u.full_name
    `) as AssignTarget[];
    const out: AssignTarget[] = [];
    for (const c of coords) {
      const cities = await coordinatorInstitutionCities(sql, c.id);
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
    const ids = await coordinatorInstitutionIds(sql, user.id);
    return ids.includes(institutionId);
  }
  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT 1 AS ok
      FROM institution_coordinators link
      JOIN users u ON u.id = link.user_id
      WHERE u.role = 'coordinator'
        AND u.manager_id = ${user.id}
        AND link.institution_id = ${institutionId}
      LIMIT 1
    `) as { ok: number }[];
    return rows.length > 0;
  }
  return false;
}

/** Sync users.institution_id to the first remaining join link (legacy mirror). */
export async function syncPrimaryInstitution(
  sql: Sql,
  userId: number,
): Promise<number | null> {
  const [row] = (await sql`
    SELECT institution_id
    FROM institution_coordinators
    WHERE user_id = ${userId}
    ORDER BY linked_at, institution_id
    LIMIT 1
  `) as { institution_id: number }[];
  const primary = row?.institution_id ?? null;
  await sql`
    UPDATE users SET institution_id = ${primary} WHERE id = ${userId}
  `;
  return primary;
}
