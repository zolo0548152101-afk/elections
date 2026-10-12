import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { sanitizeSearchInput } from "@/lib/search-query";

export const runtime = "nodejs";

/** Lookup institutions by name for the link pickers. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const q = sanitizeSearchInput(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 1) return NextResponse.json({ hits: [] });

  const sql = getSql();
  const like = `%${q}%`;
  const prefix = `${q}%`;
  const rows = (await sql`
    SELECT id, name
    FROM institutions
    WHERE regexp_replace(name, '[''׳״"]+', '', 'g') ILIKE ${like}
    ORDER BY
      CASE
        WHEN regexp_replace(name, '[''׳״"]+', '', 'g') ILIKE ${prefix} THEN 0
        ELSE 1
      END,
      name
    LIMIT 12
  `) as { id: number; name: string }[];

  return NextResponse.json({
    hits: rows.map((r) => ({ id: r.id, label: r.name })),
  });
}
