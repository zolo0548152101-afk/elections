import { NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type Row = {
  ashkol: string;
  settlement_name: string;
  institution_id: number;
  institution_name: string;
  coordinator_names: string;
  ops_done: boolean | null;
};

/**
 * Admin / רכז על: ashkols already linked to an institution (and optionally done),
 * with institution + coordinator names for a compact team table.
 * done comes from ashkol_ops_status (admin סמן בוצע / לא בוצע).
 */
export async function GET() {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sql = getSql();
  const rows =
    user!.role === "super_admin"
      ? ((await sql`
          SELECT
            cl.ashkol,
            cl.settlement_name,
            i.id AS institution_id,
            i.name AS institution_name,
            coalesce(
              (
                SELECT string_agg(u.full_name, ' · ' ORDER BY u.full_name)
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
                WHERE link.institution_id = i.id
              ),
              ''
            ) AS coordinator_names,
            ops.done AS ops_done
          FROM institution_clusters ic
          JOIN clusters cl ON cl.ashkol = ic.ashkol
          JOIN institutions i ON i.id = ic.institution_id
          LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
          ORDER BY cl.settlement_name, cl.ashkol, i.name
        `) as Row[])
      : ((await sql`
          SELECT
            cl.ashkol,
            cl.settlement_name,
            i.id AS institution_id,
            i.name AS institution_name,
            coalesce(
              (
                SELECT string_agg(u.full_name, ' · ' ORDER BY u.full_name)
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id
                  AND u.role = 'coordinator'
                  AND u.manager_id = ${user!.id}
                WHERE link.institution_id = i.id
              ),
              ''
            ) AS coordinator_names,
            ops.done AS ops_done
          FROM institution_clusters ic
          JOIN clusters cl ON cl.ashkol = ic.ashkol
          JOIN institutions i ON i.id = ic.institution_id
          LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
          WHERE EXISTS (
            SELECT 1
            FROM institution_coordinators link
            JOIN users u ON u.id = link.user_id
              AND u.role = 'coordinator'
              AND u.manager_id = ${user!.id}
            WHERE link.institution_id = i.id
          )
          ORDER BY cl.settlement_name, cl.ashkol, i.name
        `) as Row[]);

  const clusters = rows.map((r) => ({
    ashkol: r.ashkol,
    settlement_name: r.settlement_name,
    institution_id: r.institution_id,
    institution_name: r.institution_name,
    coordinator_names: r.coordinator_names,
    done: r.ops_done === true,
  }));

  return NextResponse.json({ clusters });
}
