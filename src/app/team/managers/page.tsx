"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CoordClusterEditor,
  type CoordCluster,
  type CoordInstitution,
} from "@/components/CoordClusterEditor";
import { formatAshkolLabels } from "@/lib/ashkol-label";
import { ShowMore } from "@/components/ShowMore";
import { matchesSearch } from "@/lib/text-search";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institution_names: string;
  ashkols?: string;
  institutions?: CoordInstitution[];
  clusters?: CoordCluster[];
  cluster_count?: number;
  progress: { done: number; total: number; pct: number };
};

type Manager = {
  id: number;
  full_name: string;
  email: string;
  mobile: string | null;
  coordinator_count: number;
  coordinators: Coord[];
};

const APP_TEAM_MANAGERS_SORT: SortGetters<Coord, "name" | "insts" | "ashkols" | "progress" | "count"> = {
  name: (r) => r.full_name,
  insts: (r) => (r.institutions ?? []).map((i) => i.name).join(" · "),
  ashkols: (r) => formatAshkolLabels(r.clusters ?? []) || r.ashkols || "",
  progress: (r) => r.progress?.pct ?? 0,
  count: (r) => r.cluster_count ?? (r.clusters ?? []).length,
};

export default function TeamManagersPage() {
  const tsort = useSortState<"name" | "insts" | "ashkols" | "progress" | "count">();
  const router = useRouter();
  const [rows, setRows] = useState<Manager[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");
  const [editId, setEditId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    if (me.user?.role !== "super_admin") {
      router.replace("/team/coordinators");
      return;
    }
    const res = await fetch("/api/team/managers");
    const data = await res.json();
    if (!res.ok) {
      setMsgKind("err");
      setMsg(data.error || "שגיאה");
      setLoading(false);
      return;
    }
    setRows(data.managers ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = rows.filter((m) => {
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      m.full_name,
      m.email,
      m.mobile,
      ...m.coordinators.flatMap((c) => [
        c.full_name,
        c.institution_names,
        c.ashkols,
        ...(c.clusters ?? []).map((cl) => cl.ashkol),
      ]),
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
            <h1>רכזי על</h1>
          </div>
        </header>
        {loading && <p className="lede">טוען…</p>}
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
              placeholder="רכז על, רכז, מוסד, אשכול…"
            />
          </label>
        )}
        {!loading &&
          filtered.map((m) => (
            <section key={m.id} className="panel-form links-panel">
              <div className="links-panel-head">
                <h2>
                  <ShowMore text={m.full_name} />
                </h2>
                <p className="lede">
                  {[m.email, m.mobile, `${m.coordinator_count} רכזים`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {m.coordinators.length === 0 ? (
                <p className="lede">אין רכזים משויכים</p>
              ) : (
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
                      {sortRows(m.coordinators, APP_TEAM_MANAGERS_SORT, tsort.sort).map((c) => {
                        const clusters = c.clusters ?? [];
                        const institutions = c.institutions ?? [];
                        const ashkolText =
                          formatAshkolLabels(clusters) || c.ashkols || "";
                        const open = editId === c.id;
                        return (
                          <Fragment key={c.id}>
                          <tr className={open ? "row-editing" : undefined}>
                            <td>
                              <ShowMore text={c.full_name} />
                            </td>
                            <td>
                              <ShowMore text={c.institution_names} />
                            </td>
                            <td title={open ? undefined : ashkolText || undefined}>
                              {open ? (
                                <span className="muted-cell">נערך בשורה למטה</span>
                              ) : (
                                <ShowMore text={ashkolText} />
                              )}
                            </td>
                            <td title="אשכולות שסומנו בוצע מתוך האשכולות המקושרים">
                              {c.progress.done}/{c.progress.total} (
                              {c.progress.pct}%)
                            </td>
                            <td>{c.cluster_count ?? clusters.length}</td>
                            <td className="actions-cell">
                              <button
                                type="button"
                                className="export"
                                onClick={() =>
                                  setEditId((id) =>
                                    id === c.id ? null : c.id,
                                  )
                                }
                              >
                                {open ? "סגור" : "עריכת אשכולות"}
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="edit-detail-row">
                              <td colSpan={6}>
                                <CoordClusterEditor
                                  institutions={institutions}
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
              )}
            </section>
          ))}
        {!loading && filtered.length === 0 && (
          <p className="lede">אין רכזי על במערכת</p>
        )}
      </div>
    </main>
  );
}
