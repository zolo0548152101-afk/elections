import type { getSql } from "@/lib/db";

type Sql = ReturnType<typeof getSql>;

export type AshkolStreetStats = {
  ashkol: string;
  street_total: number;
  street_done: number;
  done: boolean;
};

/**
 * A cluster's streets are its linked OSM lines (eshkol_osm_streets) plus any line
 * whose streets.ashkol points at it — the same set the cluster street list shows.
 */

/** Street completion for ashkols: a street is done if any user marked it done. */
export async function ashkolStreetStats(
  sql: Sql,
  ashkols: string[],
): Promise<Map<string, AshkolStreetStats>> {
  const out = new Map<string, AshkolStreetStats>();
  if (ashkols.length === 0) return out;
  const rows = (await sql`
    WITH lines AS (
      SELECT ashkol, id AS street_id FROM streets WHERE ashkol = ANY(${ashkols})
      UNION
      SELECT ashkol, street_id FROM eshkol_osm_streets WHERE ashkol = ANY(${ashkols})
    )
    SELECT l.ashkol,
           count(*)::int AS street_total,
           count(*) FILTER (
             WHERE EXISTS (
               SELECT 1 FROM street_marks m
               WHERE m.street_id = l.street_id AND m.done
             )
           )::int AS street_done
    FROM lines l
    GROUP BY l.ashkol
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
    WITH lines AS (
      SELECT ashkol, id AS street_id FROM streets WHERE ashkol = ANY(${ashkols})
      UNION
      SELECT ashkol, street_id FROM eshkol_osm_streets WHERE ashkol = ANY(${ashkols})
    )
    SELECT l.ashkol,
           count(*)::int AS street_total,
           count(m.street_id) FILTER (WHERE m.done)::int AS street_done
    FROM lines l
    LEFT JOIN street_marks m
      ON m.street_id = l.street_id AND m.user_id = ${userId} AND m.done
    GROUP BY l.ashkol
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

export async function linkedAshkolSet(sql: Sql): Promise<Set<string>> {
  const rows = (await sql`
    SELECT DISTINCT ashkol FROM institution_clusters
  `) as { ashkol: string }[];
  return new Set(rows.map((r) => r.ashkol));
}

/** Ashkols an admin marked בוצע, including clusters that have no streets yet. */
export async function opsDoneAshkols(
  sql: Sql,
  ashkols: string[],
): Promise<Set<string>> {
  if (ashkols.length === 0) return new Set();
  const rows = (await sql`
    SELECT ashkol FROM ashkol_ops_status
    WHERE done = true AND ashkol = ANY(${ashkols})
  `) as { ashkol: string }[];
  return new Set(rows.map((r) => r.ashkol));
}

export function clusterIsDone(
  streetDone: boolean,
  opsDone: ReadonlySet<string>,
  ashkol: string,
): boolean {
  return streetDone || opsDone.has(ashkol);
}

export type ClusterProgress = { done: number; total: number; pct: number };

/**
 * Done clusters / clusters in scope.
 * `ashkols === null` counts every cluster. A cluster counts as done when
 * ashkol_ops_status says so, or every linked street is marked done.
 */
export async function clusterProgress(
  sql: Sql,
  ashkols: string[] | null,
): Promise<ClusterProgress> {
  if (ashkols && ashkols.length === 0) {
    return { done: 0, total: 0, pct: 0 };
  }

  const [row] =
    ashkols === null
      ? ((await sql`
          WITH lines AS (
            SELECT ashkol, id AS street_id FROM streets WHERE ashkol IS NOT NULL
            UNION
            SELECT ashkol, street_id FROM eshkol_osm_streets
          ),
          street AS (
            SELECT l.ashkol,
                   count(*)::int AS total,
                   count(*) FILTER (
                     WHERE EXISTS (
                       SELECT 1 FROM street_marks m
                       WHERE m.street_id = l.street_id AND m.done
                     )
                   )::int AS done
            FROM lines l
            GROUP BY l.ashkol
          )
          SELECT
            count(*)::int AS total,
            count(*) FILTER (
              WHERE ops.done = true
                 OR (coalesce(st.total, 0) > 0 AND st.total = st.done)
            )::int AS done
          FROM clusters cl
          LEFT JOIN ashkol_ops_status ops ON ops.ashkol = cl.ashkol
          LEFT JOIN street st ON st.ashkol = cl.ashkol
        `) as { total: number; done: number }[])
      : ((await sql`
          WITH scope AS (
            SELECT DISTINCT cl.ashkol
            FROM clusters cl
            WHERE cl.ashkol = ANY(${ashkols})
          ),
          lines AS (
            SELECT ashkol, id AS street_id FROM streets WHERE ashkol IN (SELECT ashkol FROM scope)
            UNION
            SELECT ashkol, street_id FROM eshkol_osm_streets WHERE ashkol IN (SELECT ashkol FROM scope)
          ),
          street AS (
            SELECT l.ashkol,
                   count(*)::int AS total,
                   count(*) FILTER (
                     WHERE EXISTS (
                       SELECT 1 FROM street_marks m
                       WHERE m.street_id = l.street_id AND m.done
                     )
                   )::int AS done
            FROM lines l
            GROUP BY l.ashkol
          )
          SELECT
            (SELECT count(*)::int FROM scope) AS total,
            count(*) FILTER (
              WHERE ops.done = true
                 OR (coalesce(st.total, 0) > 0 AND st.total = st.done)
            )::int AS done
          FROM scope sc
          LEFT JOIN ashkol_ops_status ops ON ops.ashkol = sc.ashkol
          LEFT JOIN street st ON st.ashkol = sc.ashkol
        `) as { total: number; done: number }[]);

  const done = row?.done ?? 0;
  const total = row?.total ?? 0;
  const pct = total > 0 ? Math.round((100 * done) / total) : 0;
  return { done, total, pct };
}

