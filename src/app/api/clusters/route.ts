import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql, type ClusterRow } from "@/lib/db";
import { offsetWithinSettlement } from "@/lib/geo";
import { visibleClusterAshkols } from "@/lib/streets-access";
import {
  ashkolStreetStatsForUser,
  linkedAshkolSet,
} from "@/lib/cluster-status";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const minRight = Number(sp.get("minRight") ?? "70");
  const maxTurnout = Number(sp.get("maxTurnout") ?? "60");
  const minBzb = Number(sp.get("minBzb") ?? "300");
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
            s.lat,
            s.lng
          FROM clusters c
          LEFT JOIN settlements s ON s.name_he = c.settlement_name
          WHERE c.right_pct >= ${minRight}
            AND c.turnout_pct < ${maxTurnout}
            AND c.bzb >= ${minBzb}
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
            s.lat,
            s.lng
          FROM clusters c
          LEFT JOIN settlements s ON s.name_he = c.settlement_name
          WHERE c.right_pct >= ${minRight}
            AND c.turnout_pct < ${maxTurnout}
            AND c.bzb >= ${minBzb}
            AND c.ashkol = ANY(${ashkols})
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

  const linked = await linkedAshkolSet(sql);
  const doneStats = await ashkolStreetStatsForUser(
    sql,
    sorted.map((c) => c.ashkol),
    user.id,
  );

  const withMap = sorted.map((c) => {
    const st = doneStats.get(c.ashkol);
    const status = {
      linked: linked.has(c.ashkol),
      done: st?.done ?? false,
      street_total: st?.street_total ?? 0,
      street_done: st?.street_done ?? 0,
    };
    if (c.lat == null || c.lng == null) {
      return { ...c, map_lat: null, map_lng: null, ...status };
    }
    const p = offsetWithinSettlement(c.lat, c.lng, c.ashkol);
    return { ...c, map_lat: p.lat, map_lng: p.lng, ...status };
  });

  return NextResponse.json({
    count: withMap.length,
    minRight,
    maxTurnout,
    minBzb,
    clusters: withMap,
    scoped: ashkols !== null,
  });
}
