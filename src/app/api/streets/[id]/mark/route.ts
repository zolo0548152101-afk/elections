import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { done?: boolean };
  const done = body.done !== false;
  const sql = getSql();

  const [street] = (await sql`SELECT id FROM streets WHERE id = ${id}`) as { id: string }[];
  if (!street) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (done) {
    await sql`
      INSERT INTO street_marks (street_id, done, marked_by, marked_at)
      VALUES (${id}, true, ${user.id}, now())
      ON CONFLICT (street_id) DO UPDATE SET
        done = true,
        marked_by = EXCLUDED.marked_by,
        marked_at = now()
    `;
  } else {
    await sql`DELETE FROM street_marks WHERE street_id = ${id}`;
  }

  return NextResponse.json({ id, done });
}
