"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { matchesSearch } from "@/lib/text-search";

type ClusterRef = { ashkol: string; settlement_name: string };

type Coord = {
  id: number;
  full_name: string;
  email: string;
  institutions: { id: number; name: string; settlement_name: string | null }[];
  clusters?: ClusterRef[];
  cluster_count?: number;
  progress: { done: number; total: number; pct: number };
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
    const ashkols = (c.clusters ?? []).map((d) => d.ashkol);
    const hay = [
      c.full_name,
      ...c.institutions.map((i) => i.name),
      ...ashkols,
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
                ? "כל הרכזים במערכת — מוסדות, אשכולות והתקדמות."
                : "רכזים תחתיכם — מוסדות, אשכולות והתקדמות."}
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
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => {
                    const ashkols = (c.clusters ?? []).map((d) => d.ashkol);
                    const count = c.cluster_count ?? ashkols.length;
                    return (
                      <tr key={c.id}>
                        <td>{c.full_name}</td>
                        <td>
                          {c.institutions.length
                            ? c.institutions.map((i) => i.name).join(" · ")
                            : "—"}
                        </td>
                        <td title={ashkols.join(", ")}>
                          {ashkols.length ? ashkols.join(", ") : "—"}
                        </td>
                        <td>
                          {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
                        </td>
                        <td>{count}</td>
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
