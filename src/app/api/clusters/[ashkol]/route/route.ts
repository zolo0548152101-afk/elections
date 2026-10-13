import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { readClusterRoute, saveClusterRoute } from "@/lib/cluster-route";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ ashkol: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ashkol } = await ctx.params;
  const result = await readClusterRoute(getSql(), user, decodeURIComponent(ashkol));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.route);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ ashkol: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { ashkol } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { stages?: unknown };
  const result = await saveClusterRoute(
    getSql(),
    user,
    decodeURIComponent(ashkol),
    { stages: Array.isArray(body.stages) ? body.stages : [] },
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.route);
}
