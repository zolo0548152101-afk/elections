import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql, type ClusterRow } from "@/lib/db";
import { offsetWithinSettlement } from "@/lib/geo";
import { coordinatorGroupCities } from "@/lib/streets-access";

export const runtime = "nodejs";

async function allowedSettlements(
  sql: ReturnType<typeof getSql>,
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
): Promise<string[] | null> {
  if (user.role === "super_admin") return null; // all

  if (user.role === "coordinator") {
    const cities = await coordinatorGroupCities(sql, user.id);
    const set = new Set(cities);
    if (user.settlement_name) set.add(user.settlement_name);
    return [...set];
  }

  if (user.role === "area_manager") {
    const rows = (await sql`
      SELECT DISTINCT COALESCE(g.settlement_name, u.settlement_name) AS name
      FROM users u
      LEFT JOIN group_coordinators gc ON gc.user_id = u.id
      LEFT JOIN groups g ON g.id = gc.group_id
      WHERE u.role = 'coordinator' AND u.manager_id = ${user.id}
    `) as { name: string | null }[];
    return rows.map((r) => r.name).filter((n): n is string => Boolean(n));
  }

  return [];
}

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
  const settlements = await allowedSettlements(sql, user);

  const rows = (
    settlements === null
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
      : settlements.length === 0
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
            AND c.settlement_name = ANY(${settlements})
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

  const withMap = sorted.map((c) => {
    if (c.lat == null || c.lng == null) {
      return { ...c, map_lat: null, map_lng: null };
    }
    const p = offsetWithinSettlement(c.lat, c.lng, c.ashkol);
    return { ...c, map_lat: p.lat, map_lng: p.lng };
  });

  return NextResponse.json({
    count: withMap.length,
    minRight,
    maxTurnout,
    minBzb,
    clusters: withMap,
  });
}
