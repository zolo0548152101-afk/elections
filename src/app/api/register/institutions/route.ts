import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { sanitizeSearchInput } from "@/lib/search-query";

export const runtime = "nodejs";

/** Public institution picker for activist sign-up. Names and settlements only. Empty q lists all. */
export async function GET(req: NextRequest) {
  const q = sanitizeSearchInput(req.nextUrl.searchParams.get("q") ?? "");
  const sql = getSql();
  if (!q) {
    const all = (await sql`
      SELECT id, name, settlement_name FROM institutions ORDER BY name LIMIT 500
    `) as { id: number; name: string; settlement_name: string | null }[];
    return NextResponse.json({ hits: all.map((row) => ({ ...row, label: [row.name, row.settlement_name].filter(Boolean).join(" · ") })) });
  }

  const like = `%${q}%`;
  const prefix = `${q}%`;
  const rows = (await sql`
    SELECT id, name, settlement_name
    FROM institutions
    WHERE regexp_replace(name, '[''׳״"]+', '', 'g') ILIKE ${like}
       OR regexp_replace(coalesce(settlement_name, ''), '[''׳״"]+', '', 'g') ILIKE ${like}
    ORDER BY
      CASE
        WHEN regexp_replace(name, '[''׳״"]+', '', 'g') ILIKE ${prefix} THEN 0
        ELSE 1
      END,
      name
    LIMIT 50
  `) as { id: number; name: string; settlement_name: string | null }[];

  return NextResponse.json({
    hits: rows.map((row) => ({
      id: row.id,
      name: row.name,
      settlement_name: row.settlement_name,
      label: [row.name, row.settlement_name].filter(Boolean).join(" · "),
    })),
  });
}
