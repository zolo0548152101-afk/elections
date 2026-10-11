import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ results: [] });

  const sql = getSql();
  const like = `%${q.replace(/[%_\\]/g, "")}%`;
  const rows = await sql`
    SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol, COALESCE(m.done, false) AS done,
      (
        SELECT st.name_he
        FROM settlements st
        ORDER BY (st.lat - s.lat) ^ 2 + (st.lng - s.lng) ^ 2
        LIMIT 1
      ) AS near_settlement
    FROM streets s
    LEFT JOIN street_marks m ON m.street_id = s.id
    WHERE s.name_he ILIKE ${like}
    ORDER BY s.name_he, s.lat, s.lng
    LIMIT 30
  `;
  return NextResponse.json({ results: rows });
}
