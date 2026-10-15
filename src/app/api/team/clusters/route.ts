import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, requireRole } from "@/lib/auth";
import { ashkolStreetStats } from "@/lib/cluster-status";
import { getSql } from "@/lib/db";

export const runtime = "nodejs";

type Coord = { id: number; full_name: string };

type Row = {
  ashkol: string;
  settlement_name: string;
  institution_id: number | null;
  institution_name: string | null;
  coordinator_names: string | null;
  coordinators: Coord[] | string | null;
  ops_done: boolean | null;
};

function parseCoords(value: Row["coordinators"]): Coord[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Coord[];
    } catch {
      return [];
    }
  }
  return value;
}

/**
 * Admin / רכז על.
 * scope=linked (default): ashkols already linked to an institution.
 * scope=all: every cluster, including ones with no institution yet.
 * done is ashkol_ops_status, or every linked street marked done.
 */
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  try {
    requireRole(user, ["super_admin", "area_manager"]);
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scope = req.nextUrl.searchParams.get("scope") === "all" ? "all" : "linked";
  const sql = getSql();
  const rows =
    scope === "all"
      ? await allClusters(sql, user!.role, user!.id)
      : await linkedClusters(sql, user!.role, user!.id);

  const stats = await ashkolStreetStats(sql, [...new Set(rows.map((r) => r.ashkol))]);
  const clusters = rows.map((r) => ({
    ashkol: r.ashkol,
    settlement_name: r.settlement_name,
    institution_id: r.institution_id,
    institution_name: r.institution_name ?? "",
    coordinator_names: r.coordinator_names ?? "",
    coordinators: parseCoords(r.coordinators),
    done: r.ops_done === true || (stats.get(r.ashkol)?.done ?? false),
    street_total: stats.get(r.ashkol)?.street_total ?? 0,
    street_done: stats.get(r.ashkol)?.street_done ?? 0,
  }));

  return NextResponse.json({ clusters, scope });
}

async function linkedClusters(
  sql: ReturnType<typeof getSql>,
  role: string,
  userId: number,
) {
  return role === "super_admin"
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
            coalesce(
              (
                SELECT json_agg(
                  json_build_object('id', u.id, 'full_name', u.full_name)
                  ORDER BY u.full_name
                )
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
                WHERE link.institution_id = i.id
              ),
              '[]'
            ) AS coordinators,
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
                  AND u.manager_id = ${userId}
                WHERE link.institution_id = i.id
              ),
              ''
            ) AS coordinator_names,
            coalesce(
              (
                SELECT json_agg(
                  json_build_object('id', u.id, 'full_name', u.full_name)
                  ORDER BY u.full_name
                )
                FROM institution_coordinators link
                JOIN users u ON u.id = link.user_id
                  AND u.role = 'coordinator'
                  AND u.manager_id = ${userId}
                WHERE link.institution_id = i.id
              ),
              '[]'
            ) AS coordinators,
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
              AND u.manager_id = ${userId}
            WHERE link.institution_id = i.id
          )
          ORDER BY cl.settlement_name, cl.ashkol, i.name
        `) as Row[]);
}

async function allClusters(
  sql: ReturnType<typeof getSql>,
  role: string,
  userId: number,
) {
  return role === "super_admin"
    ? ((await sql`
        WITH coord AS (
          SELECT
            link.institution_id,
            string_agg(u.full_name, ' · ' ORDER BY u.full_name) AS coordinator_names,
            json_agg(
              json_build_object('id', u.id, 'full_name', u.full_name)
              ORDER BY u.full_name
            ) AS coordinators
          FROM institution_coordinators link
          JOIN users u ON u.id = link.user_id AND u.role = 'coordinator'
          GROUP BY link.institution_id
        )
        SELECT
          cl.ashkol,
          cl.settlement_name,
          i.id AS institution_id,
          i.name AS institution_name,
          coord.coordinator_names,
          coord.coordinators,
          ops.done AS ops_done
        FROM clusters cl
        LEFT JOIN institution_clusters ic ON ic.ashkol = cl.ashkol
        LEFT JOIN institutions i ON i.id = ic.institution_id
        LEFT JOIN coord ON coord.institution_id = i.id
        LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
        ORDER BY cl.settlement_name, cl.ashkol, i.name NULLS LAST
      `) as Row[])
    : ((await sql`
        WITH coord AS (
          SELECT
            link.institution_id,
            string_agg(u.full_name, ' · ' ORDER BY u.full_name) AS coordinator_names,
            json_agg(
              json_build_object('id', u.id, 'full_name', u.full_name)
              ORDER BY u.full_name
            ) AS coordinators
          FROM institution_coordinators link
          JOIN users u ON u.id = link.user_id
            AND u.role = 'coordinator'
            AND u.manager_id = ${userId}
          GROUP BY link.institution_id
        )
        SELECT
          cl.ashkol,
          cl.settlement_name,
          i.id AS institution_id,
          i.name AS institution_name,
          coord.coordinator_names,
          coord.coordinators,
          ops.done AS ops_done
        FROM clusters cl
        LEFT JOIN institution_clusters ic ON ic.ashkol = cl.ashkol
        LEFT JOIN institutions i ON i.id = ic.institution_id
        LEFT JOIN coord ON coord.institution_id = i.id
        LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
        ORDER BY cl.settlement_name, cl.ashkol, i.name NULLS LAST
      `) as Row[]);
}
