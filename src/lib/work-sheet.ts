import type { getSql } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canAccessAshkol } from "@/lib/streets-access";
import { clusterColors, MAP_COLOR } from "@/lib/map-colors";

type Sql = ReturnType<typeof getSql>;

export type SheetStreet = {
  id: string;
  name_he: string;
  done: boolean;
  /** Apartments and voters of this cluster on the street (0 when unknown). */
  door_count: number;
  voter_count: number;
  paths: [number, number][][];
};

export type SheetInstitution = {
  id: number;
  name: string;
  settlement_name: string | null;
  kind: string | null;
};

export type SheetCluster = {
  ashkol: string;
  settlement_name: string;
  bzb: number;
  voters: number;
  valid: number;
  turnout_pct: number;
  right_votes: number;
  right_pct: number;
  ballot_count: number;
};

export type SheetCoordinator = {
  id: number;
  full_name: string;
  mobile: string | null;
};

export type SheetSection = {
  institutions: SheetInstitution[];
  cluster: SheetCluster;
  coordinators: SheetCoordinator[];
  marker: { lat: number; lng: number } | null;
  /** The cluster's houses as [lat, lng]; the sheet map is framed on these. */
  houses: [number, number][];
  /** The cluster's color on the map (its streets and houses). */
  color: string;
  streets: SheetStreet[];
  street_total: number;
  streets_truncated: boolean;
};

export type WorkSheet = {
  kind: "coordinator" | "cluster";
  title: string;
  subtitle: string;
  sections: SheetSection[];
};

const STREET_CAP = 200;

type ClusterSql = {
  ashkol: string;
  settlement_name: string;
  bzb: number;
  voters: number;
  valid: number;
  turnout_pct: number;
  right_votes: number;
  right_pct: number;
  ballot_count: number;
  lat: number | null;
  lng: number | null;
};

type StreetSql = {
  id: string;
  name_he: string;
  ashkol: string;
  lat: number | null;
  lng: number | null;
  done: boolean;
  door_count: number | null;
  voter_count: number | null;
  geom_geojson: unknown;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function downsample(points: [number, number][], max: number): [number, number][] {
  if (points.length <= max) return points;
  const out: [number, number][] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

function toLatLng(coords: unknown): [number, number][] {
  if (!Array.isArray(coords)) return [];
  const pts: [number, number][] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng]);
  }
  return downsample(pts, 50);
}

function pathsFromGeom(raw: unknown): [number, number][][] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  const obj = value as {
    type?: string;
    geometry?: unknown;
    features?: unknown[];
    coordinates?: unknown;
  };
  if (obj.type === "Feature") return pathsFromGeom(obj.geometry);
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return obj.features.flatMap((f) => pathsFromGeom(f));
  }
  if (obj.type === "GeometryCollection" && Array.isArray((obj as { geometries?: unknown[] }).geometries)) {
    return ((obj as { geometries: unknown[] }).geometries).flatMap((g) => pathsFromGeom(g));
  }
  if (obj.type === "LineString") {
    const line = toLatLng(obj.coordinates);
    return line.length ? [line] : [];
  }
  if (obj.type === "MultiLineString" && Array.isArray(obj.coordinates)) {
    return (obj.coordinates as unknown[])
      .map((line) => toLatLng(line))
      .filter((line) => line.length > 0);
  }
  if (obj.type === "Point") {
    const point = toLatLng([obj.coordinates]);
    return point.length ? [point] : [];
  }
  return [];
}

async function sectionsFor(
  sql: Sql,
  links: { ashkol: string; institution: SheetInstitution }[],
  markUserId: number,
): Promise<SheetSection[]> {
  const ashkols = [...new Set(links.map((l) => l.ashkol))];
  if (ashkols.length === 0) return [];

  const clusters = (await sql`
    SELECT c.ashkol, c.settlement_name, c.bzb, c.voters, c.valid,
           c.turnout_pct, c.right_votes, c.right_pct, c.ballot_count,
           h.lat, h.lng
    FROM clusters c
    LEFT JOIN (
      SELECT ashkol, AVG(lat) AS lat, AVG(lng) AS lng
      FROM eshkol_houses
      GROUP BY ashkol
    ) h ON h.ashkol = c.ashkol
    WHERE c.ashkol = ANY(${ashkols})
  `) as ClusterSql[];
  const byAshkol = new Map(clusters.map((c) => [c.ashkol, c]));

  // Same streets as the map: owned lines (streets.ashkol) plus shared lines (eshkol_osm_streets).
  const counts = (await sql`
    SELECT ashkol, count(DISTINCT street_id)::int AS n
    FROM (
      SELECT id AS street_id, ashkol FROM streets WHERE ashkol = ANY(${ashkols})
      UNION
      SELECT street_id, ashkol FROM eshkol_osm_streets WHERE ashkol = ANY(${ashkols})
    ) linked
    GROUP BY ashkol
  `) as { ashkol: string; n: number }[];
  const countByAshkol = new Map(counts.map((r) => [r.ashkol, r.n]));

  const streets = (await sql`
    WITH linked AS (
      SELECT id AS street_id, ashkol FROM streets WHERE ashkol = ANY(${ashkols})
      UNION
      SELECT street_id, ashkol FROM eshkol_osm_streets WHERE ashkol = ANY(${ashkols})
    ),
    tallies AS (
      SELECT l.ashkol, l.street_id,
             SUM(es.door_count) AS door_count,
             SUM(es.voter_count) AS voter_count
      FROM eshkol_osm_streets l
      JOIN eshkol_streets es ON es.ashkol = l.ashkol AND es.street_name = l.street_name
      WHERE l.ashkol = ANY(${ashkols})
      GROUP BY l.ashkol, l.street_id
    )
    SELECT id, name_he, ashkol, lat, lng, done, door_count, voter_count, geom_geojson
    FROM (
      SELECT s.id, s.name_he, k.ashkol, s.lat, s.lng, s.geom_geojson,
             t.door_count, t.voter_count,
             EXISTS (
               SELECT 1 FROM street_marks m
               WHERE m.street_id = s.id AND m.user_id = ${markUserId} AND m.done
             ) AS done,
             row_number() OVER (PARTITION BY k.ashkol ORDER BY s.name_he, s.id) AS rn
      FROM linked k
      JOIN streets s ON s.id = k.street_id
      LEFT JOIN tallies t ON t.ashkol = k.ashkol AND t.street_id = k.street_id
    ) ranked
    WHERE rn <= ${STREET_CAP}
    ORDER BY ashkol, name_he, id
  `) as StreetSql[];

  const houseRows = (await sql`
    SELECT ashkol, lat, lng
    FROM eshkol_houses
    WHERE ashkol = ANY(${ashkols}) AND lat IS NOT NULL AND lng IS NOT NULL
    LIMIT 5000
  `) as { ashkol: string; lat: number; lng: number }[];
  const colors = await clusterColors(sql, ashkols);
  const housesByAshkol = new Map<string, [number, number][]>();
  for (const h of houseRows) {
    const list = housesByAshkol.get(h.ashkol) ?? [];
    if (list.length < 800) list.push([num(h.lat), num(h.lng)]);
    housesByAshkol.set(h.ashkol, list);
  }
  const streetsByAshkol = new Map<string, SheetStreet[]>();
  for (const s of streets) {
    const paths = pathsFromGeom(s.geom_geojson);
    if (paths.length === 0 && s.lat != null && s.lng != null) {
      paths.push([[num(s.lat), num(s.lng)]]);
    }
    const list = streetsByAshkol.get(s.ashkol) ?? [];
    list.push({
      id: s.id,
      name_he: s.name_he,
      done: s.done === true,
      door_count: num(s.door_count),
      voter_count: num(s.voter_count),
      paths,
    });
    streetsByAshkol.set(s.ashkol, list);
  }

  const grouped = new Map<string, SheetInstitution[]>();
  for (const link of links) {
    const list = grouped.get(link.ashkol) ?? [];
    if (!list.some((i) => i.id === link.institution.id)) list.push(link.institution);
    grouped.set(link.ashkol, list);
  }

  const sections: SheetSection[] = [];
  for (const ashkol of ashkols) {
    const row = byAshkol.get(ashkol);
    if (!row) continue;
    const lat = row.lat == null ? null : num(row.lat);
    const lng = row.lng == null ? null : num(row.lng);
    const marker = lat != null && lng != null ? { lat, lng } : null;
    const total = countByAshkol.get(ashkol) ?? 0;
    sections.push({
      institutions: grouped.get(ashkol) ?? [],
      coordinators: [],
      cluster: {
        ashkol: row.ashkol,
        settlement_name: row.settlement_name,
        bzb: num(row.bzb),
        voters: num(row.voters),
        valid: num(row.valid),
        turnout_pct: num(row.turnout_pct),
        right_votes: num(row.right_votes),
        right_pct: num(row.right_pct),
        ballot_count: num(row.ballot_count),
      },
      marker,
      houses: housesByAshkol.get(ashkol) ?? [],
      color: colors.get(ashkol) ?? MAP_COLOR.unknownCluster,
      streets: streetsByAshkol.get(ashkol) ?? [],
      street_total: total,
      streets_truncated: total > STREET_CAP,
    });
  }
  sections.sort((a, b) =>
    a.cluster.settlement_name.localeCompare(b.cluster.settlement_name, "he") ||
    a.cluster.ashkol.localeCompare(b.cluster.ashkol, "he"),
  );
  return sections;
}

async function coordinatorsForAshkols(
  sql: Sql,
  ashkols: string[],
  managerId: number | null,
): Promise<Map<string, SheetCoordinator[]>> {
  const grouped = new Map<string, SheetCoordinator[]>();
  if (ashkols.length === 0) return grouped;
  const rows = (managerId == null
    ? await sql`
        SELECT DISTINCT ic.ashkol, u.id, u.full_name, u.mobile
        FROM institution_clusters ic
        JOIN institution_coordinators link ON link.institution_id = ic.institution_id
        JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
        WHERE ic.ashkol = ANY(${ashkols})
        ORDER BY u.full_name, u.id
      `
    : await sql`
        SELECT DISTINCT ic.ashkol, u.id, u.full_name, u.mobile
        FROM institution_clusters ic
        JOIN institution_coordinators link ON link.institution_id = ic.institution_id
        JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
        WHERE ic.ashkol = ANY(${ashkols})
          AND u.manager_id = ${managerId}
        ORDER BY u.full_name, u.id
      `) as {
    ashkol: string;
    id: number;
    full_name: string;
    mobile: string | null;
  }[];
  for (const row of rows) {
    const list = grouped.get(row.ashkol) ?? [];
    if (!list.some((c) => c.id === row.id)) {
      list.push({
        id: row.id,
        full_name: row.full_name,
        mobile: row.mobile?.trim() || null,
      });
    }
    grouped.set(row.ashkol, list);
  }
  return grouped;
}

export async function coordinatorWorkSheet(
  sql: Sql,
  viewer: SessionUser,
  coordinatorId: number,
): Promise<{ sheet: WorkSheet } | { error: string; status: number }> {
  if (!Number.isInteger(coordinatorId) || coordinatorId <= 0) {
    return { error: "רכז לא חוקי", status: 400 };
  }
  const [coord] = (await sql`
    SELECT id, full_name, mobile, role, manager_id
    FROM users
    WHERE id = ${coordinatorId}
    LIMIT 1
  `) as {
    id: number;
    full_name: string;
    mobile: string | null;
    role: string;
    manager_id: number | null;
  }[];
  if (!coord || coord.role !== "coordinator") {
    return { error: "רכז לא נמצא", status: 404 };
  }
  if (viewer.role === "area_manager" && coord.manager_id !== viewer.id) {
    return { error: "אין הרשאה לרכז זה", status: 403 };
  }
  if (viewer.role !== "super_admin" && viewer.role !== "area_manager") {
    return { error: "אין הרשאה", status: 403 };
  }

  const links = (await sql`
    SELECT ic.ashkol, i.id, i.name, i.settlement_name, i.kind
    FROM institution_coordinators link
    JOIN institution_clusters ic ON ic.institution_id = link.institution_id
    JOIN institutions i ON i.id = ic.institution_id
    WHERE link.user_id = ${coord.id}
    ORDER BY i.name, ic.ashkol
  `) as {
    ashkol: string;
    id: number;
    name: string;
    settlement_name: string | null;
    kind: string | null;
  }[];

  const sections = await sectionsFor(
    sql,
    links.map((l) => ({
      ashkol: l.ashkol,
      institution: {
        id: l.id,
        name: l.name,
        settlement_name: l.settlement_name,
        kind: l.kind,
      },
    })),
    coord.id,
  );
  const person: SheetCoordinator = {
    id: coord.id,
    full_name: coord.full_name,
    mobile: coord.mobile?.trim() || null,
  };
  for (const section of sections) section.coordinators = [person];

  return {
    sheet: {
      kind: "coordinator",
      title: coord.full_name,
      subtitle: coord.mobile?.trim() || "",
      sections,
    },
  };
}

export async function clusterWorkSheet(
  sql: Sql,
  viewer: SessionUser,
  ashkol: string,
): Promise<{ sheet: WorkSheet } | { error: string; status: number }> {
  const id = ashkol.trim();
  if (!id) return { error: "אשכול חסר", status: 400 };
  if (viewer.role !== "super_admin" && viewer.role !== "area_manager" && viewer.role !== "coordinator") {
    return { error: "אין הרשאה", status: 403 };
  }
  // A coordinator gets the sheet of a cluster linked to one of their institutions.
  if (viewer.role === "coordinator" && !(await canAccessAshkol(sql, viewer, id))) {
    return { error: "אין הרשאה לאשכול זה", status: 403 };
  }

  const [cluster] = (await sql`
    SELECT ashkol, settlement_name FROM clusters WHERE ashkol = ${id} LIMIT 1
  `) as { ashkol: string; settlement_name: string }[];
  if (!cluster) return { error: "אשכול לא נמצא", status: 404 };

  if (viewer.role === "area_manager") {
    const [allowed] = (await sql`
      SELECT 1 AS ok
      FROM institution_clusters ic
      JOIN institution_coordinators link ON link.institution_id = ic.institution_id
      JOIN users u ON u.id = link.user_id
      WHERE ic.ashkol = ${id}
        AND u.role = 'coordinator'
        AND u.manager_id = ${viewer.id}
      LIMIT 1
    `) as { ok: number }[];
    if (!allowed) return { error: "אין הרשאה לאשכול זה", status: 403 };
  }

  const institutions = (await sql`
    SELECT i.id, i.name, i.settlement_name, i.kind
    FROM institution_clusters ic
    JOIN institutions i ON i.id = ic.institution_id
    WHERE ic.ashkol = ${id}
    ORDER BY i.name
  `) as SheetInstitution[];

  const sections = await sectionsFor(
    sql,
    institutions.length
      ? institutions.map((institution) => ({ ashkol: id, institution }))
      : [{ ashkol: id, institution: { id: 0, name: "", settlement_name: null, kind: null } }],
    viewer.id,
  );
  if (institutions.length === 0 && sections[0]) {
    sections[0].institutions = [];
  }
  const people = await coordinatorsForAshkols(
    sql,
    [id],
    viewer.role === "area_manager" ? viewer.id : null,
  );
  for (const section of sections) {
    section.coordinators = people.get(section.cluster.ashkol) ?? [];
  }

  return {
    sheet: {
      kind: "cluster",
      title: `${cluster.settlement_name} · ${cluster.ashkol}`,
      subtitle: "",
      sections,
    },
  };
}
