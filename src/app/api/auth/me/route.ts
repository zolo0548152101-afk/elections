import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { clusterProgress, type ClusterProgress } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";
import { visibleClusterAshkols } from "@/lib/streets-access";

export const runtime = "nodejs";

const PROGRESS_TTL_MS = 20_000;
const progressCache = new Map<string, { at: number; progress: ClusterProgress }>();

function progressCacheKey(scope: string[] | null) {
  if (scope === null) return "*";
  return [...scope].sort().join("\0");
}

async function cachedClusterProgress(
  sql: ReturnType<typeof getSql>,
  scope: string[] | null,
) {
  const key = progressCacheKey(scope);
  const hit = progressCache.get(key);
  if (hit && Date.now() - hit.at < PROGRESS_TTL_MS) return hit.progress;
  const progress = await clusterProgress(sql, scope);
  if (progressCache.size > 200) progressCache.clear();
  progressCache.set(key, { at: Date.now(), progress });
  return progress;
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const sql = getSql();
  const scope = await visibleClusterAshkols(sql, user);
  const progress = await cachedClusterProgress(sql, scope);

  let settlement: { name_he: string; lat: number; lng: number } | null = null;
  if (user.settlement_name) {
    const [row] = (await sql`
      SELECT name_he, lat, lng FROM settlements
      WHERE name_he = ${user.settlement_name}
      LIMIT 1
    `) as { name_he: string; lat: number; lng: number }[];
    settlement = row ?? null;
  }

  return NextResponse.json({ user, progress, settlement });
}
