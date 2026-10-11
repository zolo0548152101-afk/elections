"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CoordClusterEditor,
  type CoordCluster,
  type CoordInstitution,
} from "@/components/CoordClusterEditor";
import { formatAshkolLabel, formatAshkolLabels } from "@/lib/ashkol-label";
import { matchesSearch } from "@/lib/text-search";

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institutions: CoordInstitution[];
  clusters?: CoordCluster[];
  cluster_count?: number;
  progress: { done: number; total: number; pct: number };
};

export default function TeamCoordinatorsPage() {
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
            <p className="eyebrow">ניהול</p>
            <h1>{meRole === "super_admin" ? "רכזים" : "רכזים שלי"}</h1>
            <p className="lede">
              {meRole === "super_admin"
                ? "כל הרכזים במערכת — מוסדות, אשכולות והתקדמות. ניתן להוסיף/להסיר אשכולות."
                : "רכזים תחתיכם — מוסדות, אשכולות והתקדמות. ניתן להוסיף/להסיר אשכולות."}
            </p>
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
          <label className="panel-form" style={{ display: "block" }}>
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>שם</th>
                    <th>מוסדות</th>
                    <th>אשכולות</th>
                    <th>התקדמות</th>
                    <th>כמות אשכולות</th>
                    <th>פעולות</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const clusters = c.clusters ?? [];
                    const ashkolText = formatAshkolLabels(clusters);
                    const count = c.cluster_count ?? clusters.length;
                    const open = editId === c.id;
                    return (
                      <tr key={c.id} className={open ? "row-editing" : undefined}>
                        <td>{c.full_name}</td>
                        <td>
                          {c.institutions.length
                            ? c.institutions.map((i) => i.name).join(" · ")
                            : "—"}
                        </td>
                        <td title={ashkolText || undefined}>
                          {ashkolText || "—"}
                          {open && (
                            <CoordClusterEditor
                              institutions={c.institutions}
                              clusters={clusters}
                              onChanged={load}
                              onMessage={(kind, text) => {
                                setMsgKind(kind);
                                setMsg(text);
                              }}
                            />
                          )}
                        </td>
                        <td>
                          {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
                        </td>
                        <td>{count}</td>
                        <td className="actions-cell">
                          <button
                            type="button"
                            className="export"
                            onClick={() =>
                              setEditId((id) => (id === c.id ? null : c.id))
                            }
                          >
                            {open ? "סגור" : "עריכת אשכולות"}
                          </button>
                        </td>
                      </tr>
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
