"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type DoneCluster = {
  ashkol: string;
  settlement_name: string;
  street_total: number;
  street_done: number;
};

type Coord = {
  id: number;
  full_name: string;
  email: string;
  mobile: string | null;
  settlement_name: string | null;
  manager_name: string | null;
  institutions: { id: number; name: string; settlement_name: string | null }[];
  progress: { done: number; total: number; pct: number };
  done_clusters: DoneCluster[];
};

export default function TeamCoordinatorsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Coord[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [meRole, setMeRole] = useState<string>("");

  useEffect(() => {
    void (async () => {
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
        setMsg(data.error || "שגיאה");
        setLoading(false);
        return;
      }
      setRows(data.coordinators ?? []);
      setLoading(false);
    })();
  }, [router]);

  const filtered = rows.filter((c) => {
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      c.full_name,
      c.email,
      c.settlement_name,
      c.manager_name,
      ...c.institutions.map((i) => i.name),
      ...c.done_clusters.map((d) => d.ashkol),
    ]
      .filter(Boolean)
      .join(" ");
    return hay.includes(needle);
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
                ? "כל הרכזים במערכת — התקדמות סימון רחובות ואשכולות שסומנו כבוצעו."
                : "כל הרכזים המקושרים אליכם — התקדמות סימון רחובות ואשכולות שסומנו כבוצעו."}
            </p>
          </div>
        </header>
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && (
          <label className="panel-form" style={{ display: "block" }}>
            חיפוש
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="שם, יישוב, מוסד, אשכול…"
            />
          </label>
        )}
        {!loading &&
          filtered.map((c) => (
            <section key={c.id} className="panel-form links-panel">
              <div className="links-panel-head">
                <h2>{c.full_name}</h2>
                <p className="lede">
                  {[c.settlement_name, c.email, c.manager_name ? `רכז על: ${c.manager_name}` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <p className="lede" style={{ marginBottom: "0.5rem" }}>
                מוסדות:{" "}
                {c.institutions.length
                  ? c.institutions.map((i) => i.name).join(" · ")
                  : "אין"}
              </p>
              <p className="lede" style={{ marginBottom: "0.75rem" }}>
                התקדמות רחובות: {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
              </p>
              <strong>אשכולות שבוצעו ({c.done_clusters.length})</strong>
              {c.done_clusters.length === 0 ? (
                <p className="lede" style={{ marginTop: "0.35rem" }}>
                  עדיין אין אשכול שסומן במלואו
                </p>
              ) : (
                <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>אשכול</th>
                        <th>יישוב</th>
                        <th>רחובות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.done_clusters.map((d) => (
                        <tr key={d.ashkol}>
                          <td className="mono">{d.ashkol}</td>
                          <td>{d.settlement_name}</td>
                          <td>
                            {d.street_done}/{d.street_total}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        {!loading && filtered.length === 0 && (
          <p className="lede">אין רכזים להצגה</p>
        )}
      </div>
    </main>
  );
}
