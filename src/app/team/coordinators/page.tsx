"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  CoordCluster,
  CoordInstitution,
} from "@/components/CoordClusterEditor";
import { CoordinatorLinkRows } from "@/components/CoordinatorLinkRows";
import { formatAshkolLabel, formatAshkolLabels } from "@/lib/ashkol-label";
import { ShowMore } from "@/components/ShowMore";
import { matchesSearch } from "@/lib/text-search";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";
import { Quip } from "@/components/Quip";
import { LOADING } from "@/lib/quips";
import { PageQuip } from "@/components/PageQuip";

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institutions: CoordInstitution[];
  clusters?: CoordCluster[];
  cluster_count?: number;
  progress: { done: number; total: number; pct: number };
};

const APP_TEAM_COORDINATORS_SORT: SortGetters<Coord, "name" | "insts" | "ashkols" | "progress" | "count"> = {
  name: (r) => r.full_name,
  insts: (r) => r.institutions.map((i) => i.name).join(" · "),
  ashkols: (r) => formatAshkolLabels(r.clusters ?? []),
  progress: (r) => r.progress.pct,
  count: (r) => r.cluster_count ?? (r.clusters ?? []).length,
};

export default function TeamCoordinatorsPage() {
  const tsort = useSortState<"name" | "insts" | "ashkols" | "progress" | "count">();
  const router = useRouter();
  const [rows, setRows] = useState<Coord[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");
  const [meRole, setMeRole] = useState<string>("");
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const role = me.user?.role;
    setMeRole(role ?? "");
    if (role !== "super_admin" && role !== "area_manager") {
      router.replace("/");
      return;
    }
    const res = await fetch("/api/team/coordinators");
    const data = await res.json();
    if (!res.ok) {
      setMsgKind("err");
      setMsg(data.error || "שגיאה");
      setLoading(false);
      return;
    }
    setRows(data.coordinators ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((c) => {
    const needle = q.trim();
    if (!needle) return true;
    const ashkols = (c.clusters ?? []).map((d) =>
      formatAshkolLabel(d.ashkol, d.settlement_name),
    );
    const hay = [
      c.full_name,
      ...c.institutions.map((i) => i.name),
      ...ashkols,
      ...(c.clusters ?? []).map((d) => d.settlement_name),
    ]
      .filter(Boolean)
      .join(" ");
    return matchesSearch(hay, needle);
  });

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <h1>{meRole === "super_admin" ? "רכזים" : "רכזים שלי"}</h1>
            <PageQuip />
          </div>
        </header>
        {loading && <p className="lede"><Quip list={LOADING} /></p>}
        {!loading && msg && (
          <p
            className={`form-msg ${msgKind === "ok" ? "form-msg-ok" : "form-msg-err"}`}
            role="status"
          >
            {msg}
          </p>
        )}
        {!loading && (
          <label className="panel-form search-strip">
            חיפוש
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="שם, מוסד, אשכול…"
            />
          </label>
        )}
        {!loading && filtered.length > 0 && (
          <section className="panel-form links-panel">
            <div className={`table-wrap${editId != null ? " is-editing" : ""}`}>
              <table>
                <thead>
                  <tr>
                    <SortTh k="name" sort={tsort.sort} onSort={tsort.toggle}>שם</SortTh>
                    <SortTh k="insts" sort={tsort.sort} onSort={tsort.toggle}>מוסדות</SortTh>
                    <SortTh k="ashkols" sort={tsort.sort} onSort={tsort.toggle}>אשכולות</SortTh>
                    <SortTh k="progress" sort={tsort.sort} onSort={tsort.toggle}>התקדמות</SortTh>
                    <SortTh k="count" sort={tsort.sort} onSort={tsort.toggle}>כמות אשכולות</SortTh>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {sortRows(filtered, APP_TEAM_COORDINATORS_SORT, tsort.sort).map((c) => {
                    const clusters = c.clusters ?? [];
                    const ashkolText = formatAshkolLabels(clusters);
                    const count = c.cluster_count ?? clusters.length;
                    const open = editId === c.id;
                    return (
                      <Fragment key={c.id}>
                      <tr className={open ? "row-editing" : undefined}>
                        <td>
                          <ShowMore text={c.full_name} />
                        </td>
                        <td>
                          {open ? (
                            <span className="muted-cell">נערך בשורה למטה</span>
                          ) : (
                            <ShowMore
                              text={
                                c.institutions.length
                                  ? c.institutions.map((i) => i.name).join(" · ")
                                  : ""
                              }
                            />
                          )}
                        </td>
                        <td title={open ? undefined : ashkolText || undefined}>
                          {open ? (
                            <span className="muted-cell">נערך בשורה למטה</span>
                          ) : (
                            <ShowMore text={ashkolText} />
                          )}
                        </td>
                        <td title="אשכולות שסומנו בוצע מתוך האשכולות המקושרים">
                          {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
                        </td>
                        <td>{count}</td>
                        <td className="actions-cell">
                          <a
                            className="export"
                            href={`/team/coordinators/${c.id}/sheet`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            PDF
                          </a>
                          <button
                            type="button"
                            className="export"
                            onClick={() =>
                              setEditId((id) => (id === c.id ? null : c.id))
                            }
                          >
                            {open ? "סגור" : "קשרים"}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr className="edit-detail-row">
                          <td colSpan={6}>
                            <CoordinatorLinkRows
                              coordinatorId={c.id}
                              institutions={c.institutions}
                              clusters={clusters}
                              onChanged={load}
                              onMessage={(kind, text) => {
                                setMsgKind(kind);
                                setMsg(text);
                              }}
                            />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              מציג {filtered.length} / {rows.length}
            </p>
          </section>
        )}
        {!loading && filtered.length === 0 && (
          <p className="lede">אין רכזים להצגה</p>
        )}
      </div>
    </main>
  );
}
