import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type Row = {
  ashkol: string;
  settlement_name: string;
  bzb: number;
  turnout_pct: number;
  right_pct: number;
  likud_pct: number;
  institution_names: string;
  coordinator_names: string;
  linked: boolean;
  ops_done: boolean | null;
};

/**
 * Admin / רכז על: every ashkol, with optional institution/coordinator links
 * and ops done status. One row per ashkol (not per old link row).
 */
export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const managerId = user!.role === "area_manager" ? user!.id : null;

  const rows = (await sql`
    SELECT
      cl.ashkol,
      cl.settlement_name,
      cl.bzb,
      cl.turnout_pct,
      cl.right_pct,
      cl.likud_pct,
      coalesce(
        (
          SELECT string_agg(i.name, ' · ' ORDER BY i.name)
          FROM (
            SELECT DISTINCT i.name
            FROM institution_clusters ic
            JOIN institutions i ON i.id = ic.institution_id
            WHERE ic.ashkol = cl.ashkol
          ) i
        ),
        ''
      ) AS institution_names,
      coalesce(
        (
          SELECT string_agg(u.full_name, ' · ' ORDER BY u.full_name)
          FROM (
            SELECT DISTINCT u.full_name
            FROM institution_clusters ic
            JOIN institution_coordinators link ON link.institution_id = ic.institution_id
            JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
            WHERE ic.ashkol = cl.ashkol
              AND (
                ${managerId}::int IS NULL
                OR u.manager_id = ${managerId}
              )
          ) u
        ),
        ''
      ) AS coordinator_names,
      EXISTS (
        SELECT 1 FROM institution_clusters ic WHERE ic.ashkol = cl.ashkol
      ) AS linked,
      ops.done AS ops_done
    FROM clusters cl
    LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
    ORDER BY cl.settlement_name, cl.ashkol
  `) as Row[];

  const clusters = rows.map((r) => ({
    ashkol: r.ashkol,
    settlement_name: r.settlement_name,
    bzb: Number(r.bzb),
    turnout_pct: Number(r.turnout_pct),
    right_pct: Number(r.right_pct),
    likud_pct: Number(r.likud_pct ?? 0),
    institution_names: r.institution_names || "",
    coordinator_names: r.coordinator_names || "",
    linked: Boolean(r.linked),
    done: r.ops_done === true,
  }));

  return NextResponse.json({ clusters, count: clusters.length });
}
