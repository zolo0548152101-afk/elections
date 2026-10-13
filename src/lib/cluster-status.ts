import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

export type AshkolStreetStats = {
  ashkol: string;
  street_total: number;
  street_done: number;
  done: boolean;
};

/** Street completion for ashkols: a street is done if any user marked it done. */
export async function ashkolStreetStats(
  sql: Sql,
  ashkols: string[],
): Promise<Map<string, AshkolStreetStats>> {
  const out = new Map<string, AshkolStreetStats>();
  if (ashkols.length === 0) return out;
  const rows = (await sql`
    SELECT s.ashkol,
           count(*)::int AS street_total,
           count(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM street_marks m
               WHERE m.street_id = s.id AND m.done
             )
           )::int AS street_done
    FROM streets s
    WHERE s.ashkol = ANY(${ashkols})
    GROUP BY s.ashkol
  `) as { ashkol: string; street_total: number; street_done: number }[];
  for (const r of rows) {
    out.set(r.ashkol, {
      ashkol: r.ashkol,
      street_total: r.street_total,
      street_done: r.street_done,
      done: r.street_total > 0 && r.street_total === r.street_done,
    });
  }
  return out;
}

/** Per-user street completion for ashkols (map progress). */
export async function ashkolStreetStatsForUser(
  sql: Sql,
  ashkols: string[],
  userId: number,
): Promise<Map<string, AshkolStreetStats>> {
  const out = new Map<string, AshkolStreetStats>();
  if (ashkols.length === 0) return out;
  const rows = (await sql`
    SELECT s.ashkol,
           count(*)::int AS street_total,
           count(m.street_id) FILTER (WHERE m.done)::int AS street_done
    FROM streets s
    LEFT JOIN street_marks m
      ON m.street_id = s.id AND m.user_id = ${userId} AND m.done
    WHERE s.ashkol = ANY(${ashkols})
    GROUP BY s.ashkol
  `) as { ashkol: string; street_total: number; street_done: number }[];
  for (const r of rows) {
    out.set(r.ashkol, {
      ashkol: r.ashkol,
      street_total: r.street_total,
      street_done: r.street_done,
      done: r.street_total > 0 && r.street_total === r.street_done,
    });
  }
  return out;
}

/** Clusters marked done from the map button, even when no streets are linked. */
export async function opsDoneAshkols(
  sql: Sql,
  ashkols: string[],
): Promise<Set<string>> {
  if (ashkols.length === 0) return new Set();
  const rows = (await sql`
    SELECT ashkol
    FROM ashkol_ops_status
    WHERE done AND ashkol = ANY(${ashkols})
  `) as { ashkol: string }[];
  return new Set(rows.map((r) => r.ashkol));
}

export async function linkedAshkolSet(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    SELECT DISTINCT ashkol FROM institution_clusters
  `) as { ashkol: string }[];
  return new Set(rows.map((r) => r.ashkol));
}
