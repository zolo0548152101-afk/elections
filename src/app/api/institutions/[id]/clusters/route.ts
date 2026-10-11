import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { canManageInstitutionCluster } from "@/lib/streets-access";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const institutionId = Number((await ctx.params).id);
  if (!Number.isInteger(institutionId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const sql = getSql();
  if (!(await canManageInstitutionCluster(sql, user, institutionId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rows = await sql`
    SELECT ic.ashkol, ic.linked_at, c.settlement_name, c.bzb, c.right_pct, c.turnout_pct
    FROM institution_clusters ic
    JOIN clusters c ON c.ashkol = ic.ashkol
    WHERE ic.institution_id = ${institutionId}
    ORDER BY c.settlement_name, ic.ashkol
  `;
  return NextResponse.json({ clusters: rows });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const institutionId = Number((await ctx.params).id);
  if (!Number.isInteger(institutionId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const body = (await req.json()) as { ashkol?: string };
  const ashkol = body.ashkol?.trim() ?? "";
  if (!ashkol) {
    return NextResponse.json({ error: "ashkol חסר" }, { status: 400 });
  }

  const sql = getSql();
  if (!(await canManageInstitutionCluster(sql, user, institutionId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const cluster = (await sql`
    SELECT ashkol FROM clusters WHERE ashkol = ${ashkol} LIMIT 1
  `) as { ashkol: string }[];
  if (!cluster[0]) {
    return NextResponse.json({ error: "אשכול לא נמצא" }, { status: 404 });
  }

  await sql`
    INSERT INTO institution_clusters (institution_id, ashkol, linked_by)
    VALUES (${institutionId}, ${ashkol}, ${user.id})
    ON CONFLICT DO NOTHING
  `;

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const institutionId = Number((await ctx.params).id);
  if (!Number.isInteger(institutionId)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const ashkol = (req.nextUrl.searchParams.get("ashkol") ?? "").trim();
  if (!ashkol) {
    return NextResponse.json({ error: "ashkol חסר" }, { status: 400 });
  }

  const sql = getSql();
  if (!(await canManageInstitutionCluster(sql, user, institutionId))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await sql`
    DELETE FROM institution_clusters
    WHERE institution_id = ${institutionId} AND ashkol = ${ashkol}
  `;

  return NextResponse.json({ ok: true });
}
