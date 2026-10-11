import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import { coordinatorGroupCities } from "@/lib/streets-access";

export const runtime = "nodejs";

const CITY_PAD = 0.08;

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ user: null });

  const sql = getSql();
  let progress = { done: 0, total: 0 };

  if (user.role === "coordinator") {
    const cities = await coordinatorGroupCities(sql, user.id);
    const citySet = new Set(cities);
    if (user.settlement_name) citySet.add(user.settlement_name);
    const cityList = [...citySet];

    if (cityList.length > 0) {
      const [row] = (await sql`
        SELECT
          count(DISTINCT s.id)::int AS total,
          count(DISTINCT m.street_id) FILTER (WHERE m.done)::int AS done
        FROM settlements st
        JOIN streets s
          ON s.lat BETWEEN st.lat - ${CITY_PAD} AND st.lat + ${CITY_PAD}
         AND s.lng BETWEEN st.lng - ${CITY_PAD} AND st.lng + ${CITY_PAD}
        LEFT JOIN street_marks m
          ON m.street_id = s.id AND m.user_id = ${user.id} AND m.done
        WHERE st.name_he = ANY(${cityList})
      `) as { total: number; done: number }[];
      progress = row ?? progress;
    }
  } else if (user.role === "super_admin") {
    const [row] = (await sql`
      SELECT
        (SELECT count(*)::int FROM streets) AS total,
        (SELECT count(*)::int FROM street_marks WHERE user_id = ${user.id} AND done) AS done
    `) as { total: number; done: number }[];
    progress = row ?? progress;
  } else if (user.role === "area_manager") {
    const [row] = (await sql`
      SELECT
        count(DISTINCT s.id)::int AS total,
        count(DISTINCT m.street_id) FILTER (WHERE m.done)::int AS done
      FROM users u
      LEFT JOIN group_coordinators gc ON gc.user_id = u.id
      LEFT JOIN groups g ON g.id = gc.group_id
      JOIN settlements st ON st.name_he = COALESCE(g.settlement_name, u.settlement_name)
      JOIN streets s ON s.lat BETWEEN st.lat - ${CITY_PAD} AND st.lat + ${CITY_PAD}
                    AND s.lng BETWEEN st.lng - ${CITY_PAD} AND st.lng + ${CITY_PAD}
      LEFT JOIN street_marks m
        ON m.street_id = s.id AND m.user_id = ${user.id} AND m.done
      WHERE u.manager_id = ${user.id} AND u.role = 'coordinator'
    `) as { total: number; done: number }[];
    progress = row ?? progress;
  }

  let settlement: { name_he: string; lat: number; lng: number } | null = null;
  if (user.settlement_name) {
    const [row] = (await sql`
      SELECT name_he, lat, lng FROM settlements
      WHERE name_he = ${user.settlement_name}
      LIMIT 1
    `) as { name_he: string; lat: number; lng: number }[];
    settlement = row ?? null;
  }

  return NextResponse.json({ user, progress, settlement });
}
