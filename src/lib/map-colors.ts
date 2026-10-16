/**
 * The one place for map colors. The map, the legend, the status filter, the work sheet
 * and its PDF all read from here, so a color is never defined twice.
 */
import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

/** Cluster progress: diamonds, the status filter and its legend. */
export const STAGE_COLOR = {
  pending: "#2563eb", // ממתין
  partial: "#f97316", // בתהליך
  done: "#16a34a", // בוצע (also a street marked done)
} as const;

export const MAP_COLOR = {
  /** A street marked done, everywhere. */
  streetDone: STAGE_COLOR.done,
  /** Streets that belong to no cluster, and lines outside the selected cluster. */
  muted: "#a3acb9",
  /** A linked street whose cluster color is unknown. */
  unknownCluster: "#64748b",
  /** Street linked to a cluster in an older import (streets.ashkol) with no color yet. */
  assigned: "#c45c26",
  /** A cluster found by the search box. */
  search: "#22d3ee",
  /** The street section being picked for a route. */
  highlight: "#2563eb",
} as const;

/**
 * One color per cluster: its streets and its house dots share it.
 * No greens: green means "בוצע" on this map, so a cluster must never look done.
 */
export const CLUSTER_PALETTE = [
  "#c23b3b", // red
  "#2c5aa0", // blue
  "#c48a1a", // amber
  "#6b4c9a", // purple
  "#be185d", // pink
  "#0369a1", // sky
  "#9a3412", // rust
  "#7c3aed", // violet
  "#475569", // slate
  "#a16207", // ochre
  "#86198f", // plum
  "#1e3a8a", // navy
] as const;

/**
 * Route stages (hourly rounds). Off blue, green, gold, cyan, orange, red and near-black,
 * so a route never reads as a status or a cluster.
 */
export const ROUTE_STAGE_COLORS = ["#7c3aed", "#db2777", "#d946ef", "#c084fc", "#f472b6", "#e879f9"] as const;

export function routeStageColor(stageNo: number): string {
  return ROUTE_STAGE_COLORS[(Math.max(stageNo, 1) - 1) % ROUTE_STAGE_COLORS.length]!;
}

export function clusterColorByRank(rank: number | null | undefined): string {
  if (rank == null || !Number.isFinite(rank) || rank < 0) return MAP_COLOR.unknownCluster;
  return CLUSTER_PALETTE[Math.floor(rank) % CLUSTER_PALETTE.length]!;
}

/**
 * The color of each cluster, by a fixed rule: its place (by cluster number) among the clusters
 * of its town that are on the map. Computed on the server, so filters on the screen never
 * change a cluster's color, and the map and the work sheet always agree.
 */
export async function clusterColors(sql: Sql, ashkols: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ashkols.length === 0) return out;
  const rows = (await sql`
    SELECT ashkol, rank
    FROM (
      SELECT c.ashkol,
             (row_number() OVER (
               PARTITION BY c.settlement_name
               ORDER BY CASE WHEN c.ashkol ~ '^[0-9]+$' THEN c.ashkol::numeric END, c.ashkol
             ) - 1)::int AS rank
      FROM clusters c
      WHERE EXISTS (SELECT 1 FROM eshkol_osm_streets o WHERE o.ashkol = c.ashkol)
    ) ranked
    WHERE ashkol = ANY(${ashkols})
  `) as { ashkol: string; rank: number }[];
  for (const row of rows) out.set(row.ashkol, clusterColorByRank(row.rank));
  return out;
}
