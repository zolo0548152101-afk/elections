import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { clusterWorkSheet } from "@/lib/work-sheet";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ashkol: string }> },
) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager", "coordinator"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { ashkol } = await ctx.params;
  const result = await clusterWorkSheet(getSql(), user!, decodeURIComponent(ashkol));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.sheet);
}
