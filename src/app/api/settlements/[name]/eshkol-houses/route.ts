import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { visibleClusterAshkols } from "@/lib/streets-access";

export const runtime = "nodejs";

type HouseRow = {
  ashkol: string;
  street: string;
  house: number;
  lat: number;
  lng: number;
};

/** Located houses for one settlement. Restricted to ashkols the caller may see. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ name: string }> },
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { name } = await ctx.params;
  const settlement = name?.trim();
  if (!settlement) {
    return NextResponse.json({ error: "ישוב חסר" }, { status: 400 });
  }

  const sql = getSql();
  const allowed = await visibleClusterAshkols(sql, user);
  const houses = (
    allowed === null
      ? await sql`
          SELECT ashkol, street_name AS street, house_number AS house, lat, lng
          FROM eshkol_houses
          WHERE settlement_name = ${settlement}
          ORDER BY ashkol, street_name, house_number
        `
      : allowed.length === 0
        ? []
        : await sql`
          SELECT ashkol, street_name AS street, house_number AS house, lat, lng
          FROM eshkol_houses
          WHERE settlement_name = ${settlement}
            AND ashkol = ANY(${allowed})
          ORDER BY ashkol, street_name, house_number
        `
  ) as HouseRow[];

  return NextResponse.json({ settlement, houses });
}
