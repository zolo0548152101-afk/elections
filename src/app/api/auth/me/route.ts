import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { clusterProgress } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";
import { visibleClusterAshkols } from "@/lib/streets-access";

export const runtime = "nodejs";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const sql = getSql();
  const scope = await visibleClusterAshkols(sql, user);
  const progress = await clusterProgress(sql, scope);

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
