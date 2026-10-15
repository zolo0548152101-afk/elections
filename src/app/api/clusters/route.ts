import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql, type ClusterRow } from "@/lib/db";
import { visibleClusterAshkols } from "@/lib/streets-access";
import {
  ashkolStreetStatsForUser,
  clusterIsDone,
  linkedAshkolSet,
  opsDoneAshkols,
} from "@/lib/cluster-status";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const minRight = Number(sp.get("minRight") ?? "0");
  const maxTurnout = Number(sp.get("maxTurnout") ?? "100");
  const minBzb = Number(sp.get("minBzb") ?? "0");
  const minLikud = Number(sp.get("minLikud") ?? "0");
  const sort = sp.get("sort") ?? "right_pct";
  const dir = sp.get("dir") === "asc" ? "ASC" : "DESC";

  const allowedSort = new Set([
    "settlement_name",
    "ashkol",
    "bzb",
    "voters",
    "turnout_pct",
    "right_pct",
    "right_votes",
    "likud_pct",
    "likud_votes",
  ]);
  const sortCol = allowedSort.has(sort) ? sort : "right_pct";

  const sql = getSql();
  const ashkols = await visibleClusterAshkols(sql, user);

  const rows = (
    ashkols === null
      ? await sql`
          SELECT
            c.ashkol,
            c.settlement_name,
            c.settlement_code,
            c.bzb,
            c.voters,
            c.valid,
            c.right_votes,
            c.turnout_pct,
            c.right_pct,
            c.ballot_count,
            c.likud_votes,
            c.likud_pct,
            h.lat,
            h.lng
          FROM clusters c
          LEFT JOIN (
            -- Centre of the cluster's streets (median of street centres, so one long road does not drag it).
            -- Falls back to the geocoded houses for clusters that have no linked street yet.
            SELECT COALESCE(st.ashkol, hh.ashkol) AS ashkol,
                   COALESCE(st.lat, hh.lat) AS lat,
                   COALESCE(st.lng, hh.lng) AS lng
            FROM (
              SELECT l.ashkol,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lat) AS lat,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lng) AS lng
              FROM eshkol_osm_streets l
              JOIN streets s ON s.id = l.street_id
              GROUP BY l.ashkol
            ) st
            FULL JOIN (
              SELECT ashkol, AVG(lat) AS lat, AVG(lng) AS lng
              FROM eshkol_houses
              GROUP BY ashkol
            ) hh ON hh.ashkol = st.ashkol
          ) h ON h.ashkol = c.ashkol
          WHERE c.right_pct >= ${minRight}
            AND c.turnout_pct <= ${maxTurnout}
            AND c.bzb >= ${minBzb}
            AND c.likud_pct >= ${minLikud}
            AND EXISTS (SELECT 1 FROM eshkol_osm_streets o WHERE o.ashkol = c.ashkol)
        `
      : ashkols.length === 0
        ? []
        : await sql`
          SELECT
            c.ashkol,
            c.settlement_name,
            c.settlement_code,
            c.bzb,
            c.voters,
            c.valid,
            c.right_votes,
            c.turnout_pct,
            c.right_pct,
            c.ballot_count,
            c.likud_votes,
            c.likud_pct,
            h.lat,
            h.lng
          FROM clusters c
          LEFT JOIN (
            -- Centre of the cluster's streets (median of street centres, so one long road does not drag it).
            -- Falls back to the geocoded houses for clusters that have no linked street yet.
            SELECT COALESCE(st.ashkol, hh.ashkol) AS ashkol,
                   COALESCE(st.lat, hh.lat) AS lat,
                   COALESCE(st.lng, hh.lng) AS lng
            FROM (
              SELECT l.ashkol,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lat) AS lat,
                     percentile_cont(0.5) WITHIN GROUP (ORDER BY s.lng) AS lng
              FROM eshkol_osm_streets l
              JOIN streets s ON s.id = l.street_id
              GROUP BY l.ashkol
            ) st
            FULL JOIN (
              SELECT ashkol, AVG(lat) AS lat, AVG(lng) AS lng
              FROM eshkol_houses
              GROUP BY ashkol
            ) hh ON hh.ashkol = st.ashkol
          ) h ON h.ashkol = c.ashkol
          WHERE c.right_pct >= ${minRight}
            AND c.turnout_pct <= ${maxTurnout}
            AND c.bzb >= ${minBzb}
            AND c.likud_pct >= ${minLikud}
            AND c.ashkol = ANY(${ashkols})
            AND EXISTS (SELECT 1 FROM eshkol_osm_streets o WHERE o.ashkol = c.ashkol)
        `
  ) as ClusterRow[];

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortCol as keyof ClusterRow];
    const bv = b[sortCol as keyof ClusterRow];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string") {
      return dir === "ASC" ? av.localeCompare(bv, "he") : bv.localeCompare(av, "he");
    }
    const an = Number(av);
    const bn = Number(bv);
    return dir === "ASC" ? an - bn : bn - an;
  });

  const ids = sorted.map((c) => c.ashkol);
  const linked = await linkedAshkolSet(sql);
  const doneStats = await ashkolStreetStatsForUser(sql, ids, user.id);
  const opsDone = await opsDoneAshkols(sql, ids);

  const withMap = sorted.map((c) => {
    const st = doneStats.get(c.ashkol);
    const status = {
      linked: linked.has(c.ashkol),
      done: clusterIsDone(st?.done ?? false, opsDone, c.ashkol),
      street_total: st?.street_total ?? 0,
      street_done: st?.street_done ?? 0,
      ops_done: opsDone.has(c.ashkol),
    };
    if (c.lat == null || c.lng == null) {
      return { ...c, map_lat: null, map_lng: null, ...status };
    }
    return { ...c, map_lat: Number(c.lat), map_lng: Number(c.lng), ...status };
  });

  return NextResponse.json({
    count: withMap.length,
    minRight,
    maxTurnout,
    minBzb,
    minLikud,
    clusters: withMap,
    scoped: ashkols !== null,
  });
}
