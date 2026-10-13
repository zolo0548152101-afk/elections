import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { sanitizeSearchInput } from "@/lib/search-query";

export const runtime = "nodejs";

/** Public institution picker for activist sign-up. Names and settlements only. */
export async function GET(req: NextRequest) {
  const q = sanitizeSearchInput(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 2) return NextResponse.json({ hits: [] });

  const sql = getSql();
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
    LIMIT 12
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
