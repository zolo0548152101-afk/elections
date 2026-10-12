import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { sanitizeSearchInput } from "@/lib/search-query";
import { linkableSettlementNames } from "@/lib/streets-access";

export const runtime = "nodejs";

/**
 * Lookup clusters by number or settlement name.
 * Returns the ashkol id and settlement so pickers can show both.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = sanitizeSearchInput(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 1) return NextResponse.json({ clusters: [] });

  const sql = getSql();
  const names = await linkableSettlementNames(sql, user);
  if (names && names.length === 0) return NextResponse.json({ clusters: [] });

  const like = `%${q}%`;
  const prefix = `${q}%`;
  const rows =
    names === null
      ? await sql`
          SELECT ashkol, settlement_name
          FROM clusters
          WHERE ashkol ILIKE ${like}
             OR regexp_replace(settlement_name, '[''׳״"]+', '', 'g') ILIKE ${like}
          ORDER BY
            CASE
              WHEN ashkol ILIKE ${prefix} THEN 0
              WHEN regexp_replace(settlement_name, '[''׳״"]+', '', 'g') ILIKE ${prefix} THEN 1
              ELSE 2
            END,
            settlement_name,
            ashkol
          LIMIT 12
        `
      : await sql`
          SELECT ashkol, settlement_name
          FROM clusters
          WHERE settlement_name = ANY(${names})
            AND (
              ashkol ILIKE ${like}
              OR regexp_replace(settlement_name, '[''׳״"]+', '', 'g') ILIKE ${like}
            )
          ORDER BY
            CASE
              WHEN ashkol ILIKE ${prefix} THEN 0
              WHEN regexp_replace(settlement_name, '[''׳״"]+', '', 'g') ILIKE ${prefix} THEN 1
              ELSE 2
            END,
            settlement_name,
            ashkol
          LIMIT 12
        `;

  return NextResponse.json({
    clusters: (rows as { ashkol: string; settlement_name: string | null }[]).map((r) => ({
      ashkol: r.ashkol,
      settlement_name: r.settlement_name,
    })),
  });
}
