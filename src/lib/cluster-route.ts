import type { getSql } from "@/lib/db";
import type { SessionUser } from "@/lib/auth";
import { canAccessAshkol } from "@/lib/streets-access";
import type { RouteGeometry, RoutePayload, RouteStage } from "@/lib/cluster-route-types";
import { clampRatio, spanOf } from "@/lib/street-span";

type Sql = ReturnType<typeof getSql>;

const NOTE_MAX = 500;
const STAGE_MAX = 20;
const STREET_MAX = 40;
const DRAW_MAX = 30;
const VERTEX_MAX = 60;

function clipNote(value: unknown): string {
  return String(value ?? "").trim().slice(0, NOTE_MAX);
}

function downsample(points: number[][], max: number): number[][] {
  if (points.length <= max) return points;
  const out: number[][] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

function asCoordLine(coords: unknown): number[][] {
  if (!Array.isArray(coords)) return [];
  const pts: number[][] = [];
  for (const c of coords) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lng) && Number.isFinite(lat)) pts.push([lng, lat]);
  }
  return downsample(pts, 50);
}

export function geometryFromGeoJson(raw: unknown): RouteGeometry | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const obj = value as {
    type?: string;
    geometry?: unknown;
    features?: unknown[];
    coordinates?: unknown;
    geometries?: unknown[];
  };
  if (obj.type === "Feature") return geometryFromGeoJson(obj.geometry);
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    const lines = obj.features.flatMap((f) => {
      const g = geometryFromGeoJson(f);
      if (!g) return [];
      return g.type === "LineString" ? [g.coordinates] : g.coordinates;
    });
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  if (obj.type === "GeometryCollection" && Array.isArray(obj.geometries)) {
    const lines = obj.geometries.flatMap((g) => {
      const parsed = geometryFromGeoJson(g);
      if (!parsed) return [];
      return parsed.type === "LineString" ? [parsed.coordinates] : parsed.coordinates;
    });
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  if (obj.type === "LineString") {
    const line = asCoordLine(obj.coordinates);
    return line.length ? { type: "LineString", coordinates: line } : null;
  }
  if (obj.type === "MultiLineString" && Array.isArray(obj.coordinates)) {
    const lines = (obj.coordinates as unknown[])
      .map((line) => asCoordLine(line))
      .filter((line) => line.length > 0);
    return lines.length ? { type: "MultiLineString", coordinates: lines } : null;
  }
  return null;
}

function drawCoordinates(value: unknown): number[][] {
  if (!Array.isArray(value)) return [];
  const points: number[][] = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
    const prev = points[points.length - 1];
    if (prev && prev[0] === lng && prev[1] === lat) continue;
    points.push([lng, lat]);
    if (points.length >= VERTEX_MAX) break;
  }
  return points;
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "true";
}

export async function readClusterRoute(
  sql: Sql,
  user: SessionUser,
  ashkol: string,
): Promise<{ route: RoutePayload } | { error: string; status: number }> {
  const id = ashkol.trim();
  if (!id) return { error: "אשכול חסר", status: 400 };
  if (!(await canAccessAshkol(sql, user, id))) {
    return { error: "אין הרשאה לאשכול זה", status: 403 };
  }

  const stages = (await sql`
    SELECT id, stage_no
    FROM cluster_route_stages
    WHERE ashkol = ${id}
    ORDER BY stage_no
  `) as { id: number; stage_no: number }[];
  if (stages.length === 0) return { route: { stages: [] } };

  const stageIds = stages.map((s) => s.id);
  const streets = (await sql`
    SELECT r.stage_id, r.street_id, r.note, r.sort_order, r.from_ratio, r.to_ratio, r.reversed, r.done,
           s.name_he, s.geom_geojson
    FROM cluster_route_streets r
    JOIN streets s ON s.id = r.street_id
    WHERE r.stage_id = ANY(${stageIds})
    ORDER BY r.sort_order, r.id
  `) as {
    stage_id: number;
    street_id: string;
    note: string;
    sort_order: number;
    from_ratio: number;
    to_ratio: number;
    reversed: boolean;
    done: boolean;
    name_he: string;
    geom_geojson: string;
  }[];
  const points = (await sql`
    SELECT stage_id, lat, lng, note
    FROM cluster_route_points
    WHERE stage_id = ANY(${stageIds})
  `) as { stage_id: number; lat: number; lng: number; note: string }[];
  const draws = (await sql`
    SELECT stage_id, sort_order, path_geojson, done
    FROM cluster_route_draws
    WHERE stage_id = ANY(${stageIds})
    ORDER BY sort_order, id
  `) as { stage_id: number; path_geojson: string; done: boolean }[];

  const byStage = new Map<number, RouteStage>();
  for (const stage of stages) {
    byStage.set(stage.id, { stage_no: stage.stage_no, streets: [], draws: [], point: null });
  }
  for (const street of streets) {
    const fromRatio = clampRatio(street.from_ratio, 0);
    const toRatio = clampRatio(street.to_ratio, 1);
    byStage.get(street.stage_id)?.streets.push({
      street_id: street.street_id,
      name_he: street.name_he,
      note: street.note ?? "",
      from_ratio: Math.min(fromRatio, toRatio),
      to_ratio: Math.max(fromRatio, toRatio),
      reversed: Boolean(street.reversed),
      done: Boolean(street.done),
      geometry: spanOf(geometryFromGeoJson(street.geom_geojson), fromRatio, toRatio),
    });
  }
  for (const draw of draws) {
    const stage = byStage.get(draw.stage_id);
    if (!stage || stage.draws.length >= DRAW_MAX) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(draw.path_geojson);
    } catch {
      parsed = null;
    }
    const coordinates = drawCoordinates(
      parsed && typeof parsed === "object" ? (parsed as { coordinates?: unknown }).coordinates : null,
    );
    if (coordinates.length === 0) continue;
    stage.draws.push({ coordinates, done: Boolean(draw.done) });
  }
  for (const point of points) {
    const stage = byStage.get(point.stage_id);
    if (!stage) continue;
    stage.point = {
      lat: Number(point.lat),
      lng: Number(point.lng),
      note: point.note ?? "",
    };
  }

  return { route: { stages: stages.map((s) => byStage.get(s.id)!) } };
}

type IncomingStage = {
  streets?: {
    street_id?: unknown;
    note?: unknown;
    from_ratio?: unknown;
    to_ratio?: unknown;
    reversed?: unknown;
    done?: unknown;
  }[];
  point?: { lat?: unknown; lng?: unknown; note?: unknown } | null;
  draws?: { coordinates?: unknown; done?: unknown }[];
  stage_no?: unknown;
};

export async function saveClusterRoute(
  sql: Sql,
  user: SessionUser,
  ashkol: string,
  body: { stages?: unknown },
): Promise<{ route: RoutePayload } | { error: string; status: number }> {
  const id = ashkol.trim();
  if (!id) return { error: "אשכול חסר", status: 400 };
  if (!(await canAccessAshkol(sql, user, id))) {
    return { error: "אין הרשאה לאשכול זה", status: 403 };
  }
  const [cluster] = (await sql`
    SELECT ashkol FROM clusters WHERE ashkol = ${id} LIMIT 1
  `) as { ashkol: string }[];
  if (!cluster) return { error: "אשכול לא נמצא", status: 404 };

  const incoming = (Array.isArray(body.stages) ? body.stages : []).slice(0, STAGE_MAX) as IncomingStage[];
  const streetIds = [
    ...new Set(
      incoming.flatMap((stage) =>
        (Array.isArray(stage.streets) ? stage.streets : [])
          .slice(0, STREET_MAX)
          .map((s) => String(s.street_id ?? "").trim())
          .filter(Boolean),
      ),
    ),
  ];
  const known = new Set<string>();
  if (streetIds.length > 0) {
    const rows = (await sql`
      SELECT id FROM streets WHERE id = ANY(${streetIds})
    `) as { id: string }[];
    for (const row of rows) known.add(row.id);
  }
  const missing = streetIds.filter((streetId) => !known.has(streetId));
  if (missing.length > 0) {
    return { error: "רחוב לא נמצא", status: 400 };
  }

  await sql`DELETE FROM cluster_route_stages WHERE ashkol = ${id}`;
  for (let i = 0; i < incoming.length; i++) {
    const stage = incoming[i];
    if (!stage || typeof stage !== "object") continue;
    const requested = Number(stage.stage_no);
    const stageNo = Number.isInteger(requested) && requested > 0 ? requested : i + 1;
    const [created] = (await sql`
      INSERT INTO cluster_route_stages (ashkol, stage_no)
      VALUES (${id}, ${stageNo})
      RETURNING id
    `) as { id: number }[];
    const stageId = created!.id;
    const streets = (Array.isArray(stage.streets) ? stage.streets : []).slice(0, STREET_MAX);
    const seen = new Set<string>();
    let order = 0;
    for (const street of streets) {
      const streetId = String(street.street_id ?? "").trim();
      if (!streetId || seen.has(streetId)) continue;
      seen.add(streetId);
      const fromRatio = clampRatio(street.from_ratio, 0);
      const toRatio = clampRatio(street.to_ratio, 1);
      await sql`
        INSERT INTO cluster_route_streets
          (stage_id, street_id, note, sort_order, from_ratio, to_ratio, reversed, done)
        VALUES (
          ${stageId},
          ${streetId},
          ${clipNote(street.note)},
          ${order},
          ${Math.min(fromRatio, toRatio)},
          ${Math.max(fromRatio, toRatio)},
          ${street.reversed === true || street.reversed === 1 || street.reversed === "true"},
          ${truthy(street.done)}
        )
      `;
      order += 1;
    }
    const draws = (Array.isArray(stage.draws) ? stage.draws : []).slice(0, DRAW_MAX);
    let drawOrder = 0;
    for (const draw of draws) {
      const coordinates = drawCoordinates(draw.coordinates);
      if (coordinates.length === 0) continue;
      await sql`
        INSERT INTO cluster_route_draws (stage_id, sort_order, path_geojson, done)
        VALUES (
          ${stageId},
          ${drawOrder},
          ${JSON.stringify({ type: "LineString", coordinates })},
          ${truthy(draw.done)}
        )
      `;
      drawOrder += 1;
    }
    const point = stage.point;
    if (point && point.lat != null && point.lng != null) {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        await sql`
          INSERT INTO cluster_route_points (stage_id, lat, lng, note)
          VALUES (${stageId}, ${lat}, ${lng}, ${clipNote(point.note)})
        `;
      }
    }
  }

  return readClusterRoute(sql, user, id);
}
