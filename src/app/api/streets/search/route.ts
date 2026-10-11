import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getSql } from "@/lib/db";
import {
  longestCityPrefix,
  sanitizeSearchInput,
  type CityRow,
} from "@/lib/search-query";
import { streetVisibilityFilter } from "@/lib/streets-access";

export const runtime = "nodejs";

const CITY_PAD = 0.08;

type StreetHit = {
  id: string;
  name_he: string;
  lat: number;
  lng: number;
  ashkol: string | null;
  done: boolean;
  near_settlement: string | null;
};

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const raw = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const q = sanitizeSearchInput(raw);
  if (q.length < 1) {
    return NextResponse.json({ cities: [], streets: [], parsed: null });
  }

  const sql = getSql();
  const like = `%${q}%`;
  const prefix = `${q}%`;

  // Cities: prefix completions first, then contains. Also load longer names for parse.
  const cityCandidates = (await sql`
    SELECT name_he, lat, lng
    FROM settlements
    WHERE regexp_replace(name_he, '[''׳״"]+', '', 'g') ILIKE ${like}
       OR ${q} ILIKE regexp_replace(name_he, '[''׳״"]+', '', 'g') || '%'
    ORDER BY
      CASE
        WHEN regexp_replace(name_he, '[''׳״"]+', '', 'g') ILIKE ${prefix} THEN 0
        WHEN ${q} ILIKE regexp_replace(name_he, '[''׳״"]+', '', 'g') || '%' THEN 1
        ELSE 2
      END,
      length(name_he) DESC,
      name_he
    LIMIT 40
  `) as CityRow[];

  const parsed = longestCityPrefix(q, cityCandidates);
  const qLower = q.toLowerCase();
  const cities = [...cityCandidates]
    .filter((c) => {
      const n = sanitizeSearchInput(c.name_he).toLowerCase();
      return n.includes(qLower) || qLower.startsWith(n);
    })
    .sort((a, b) => {
      const an = sanitizeSearchInput(a.name_he).toLowerCase();
      const bn = sanitizeSearchInput(b.name_he).toLowerCase();
      const ap = an.startsWith(qLower) ? 0 : 1;
      const bp = bn.startsWith(qLower) ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (an.length !== bn.length) return an.length - bn.length;
      return an.localeCompare(bn, "he");
    })
    .slice(0, 8);

  const vis = await streetVisibilityFilter(sql, user);
  // When a city prefix was parsed, only search streets by the remainder
  // (so "בית שאן " alone lists cities, not every street near Beit Shean).
  const streetTerm = parsed ? parsed.remainder : q;
  const streetLike = `%${streetTerm}%`;
  const streetPrefix = `${streetTerm}%`;

  let streets: StreetHit[] = [];

  if (streetTerm.length >= 1) {
    if (parsed?.city) {
      const { lat, lng, name_he } = parsed.city;
      streets = (
        vis.active
          ? await sql`
              SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol, COALESCE(m.done, false) AS done,
                ${name_he}::text AS near_settlement
              FROM streets s
              LEFT JOIN street_marks m
                ON m.street_id = s.id AND m.user_id = ${user.id}
              WHERE regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetLike}
                AND s.lat BETWEEN ${lat - CITY_PAD} AND ${lat + CITY_PAD}
                AND s.lng BETWEEN ${lng - CITY_PAD} AND ${lng + CITY_PAD}
                AND s.ashkol = ANY(${vis.ashkols})
              ORDER BY
                CASE
                  WHEN regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetPrefix} THEN 0
                  ELSE 1
                END,
                (s.lat - ${lat}) ^ 2 + (s.lng - ${lng}) ^ 2,
                s.name_he
              LIMIT 30
            `
          : await sql`
              SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol, COALESCE(m.done, false) AS done,
                ${name_he}::text AS near_settlement
              FROM streets s
              LEFT JOIN street_marks m
                ON m.street_id = s.id AND m.user_id = ${user.id}
              WHERE regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetLike}
                AND s.lat BETWEEN ${lat - CITY_PAD} AND ${lat + CITY_PAD}
                AND s.lng BETWEEN ${lng - CITY_PAD} AND ${lng + CITY_PAD}
              ORDER BY
                CASE
                  WHEN regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetPrefix} THEN 0
                  ELSE 1
                END,
                (s.lat - ${lat}) ^ 2 + (s.lng - ${lng}) ^ 2,
                s.name_he
              LIMIT 30
            `
      ) as StreetHit[];
    }

    // Free search when no city prefix, or to fill suggestions while typing a single token.
    if (!parsed?.city || streets.length < 8) {
      const free = (
        vis.active
          ? await sql`
              SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol, COALESCE(m.done, false) AS done,
                (
                  SELECT st.name_he
                  FROM settlements st
                  ORDER BY (st.lat - s.lat) ^ 2 + (st.lng - s.lng) ^ 2
                  LIMIT 1
                ) AS near_settlement
              FROM streets s
              LEFT JOIN street_marks m
                ON m.street_id = s.id AND m.user_id = ${user.id}
              WHERE regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetLike}
                AND s.ashkol = ANY(${vis.ashkols})
              ORDER BY
                CASE
                  WHEN regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetPrefix} THEN 0
                  ELSE 1
                END,
                s.name_he, s.lat, s.lng
              LIMIT 30
            `
          : await sql`
              SELECT s.id, s.name_he, s.lat, s.lng, s.ashkol, COALESCE(m.done, false) AS done,
                (
                  SELECT st.name_he
                  FROM settlements st
                  ORDER BY (st.lat - s.lat) ^ 2 + (st.lng - s.lng) ^ 2
                  LIMIT 1
                ) AS near_settlement
              FROM streets s
              LEFT JOIN street_marks m
                ON m.street_id = s.id AND m.user_id = ${user.id}
              WHERE regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetLike}
              ORDER BY
                CASE
                  WHEN regexp_replace(s.name_he, '[''׳״"]+', '', 'g') ILIKE ${streetPrefix} THEN 0
                  ELSE 1
                END,
                s.name_he, s.lat, s.lng
              LIMIT 30
            `
      ) as StreetHit[];

      const seen = new Set(streets.map((s) => s.id));
      for (const row of free) {
        if (seen.has(row.id)) continue;
        // If a city was parsed, prefer streets in that city when merging free hits.
        if (
          parsed?.city &&
          row.near_settlement &&
          sanitizeSearchInput(row.near_settlement).toLowerCase() !==
            sanitizeSearchInput(parsed.city.name_he).toLowerCase()
        ) {
          continue;
        }
        streets.push(row);
        seen.add(row.id);
        if (streets.length >= 30) break;
      }
    }
  }

  return NextResponse.json({
    cities,
    streets,
    results: streets,
    parsed: parsed
      ? {
          city: parsed.city.name_he,
          street_term: parsed.remainder,
        }
      : null,
  });
}
