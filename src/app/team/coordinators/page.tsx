"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { matchesSearch } from "@/lib/text-search";

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

  const showManagerCol = meRole === "super_admin";

  const filtered = rows.filter((c) => {
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      c.full_name,
      c.email,
      c.mobile,
      c.settlement_name,
      c.manager_name,
      ...c.institutions.map((i) => `${i.name} ${i.settlement_name ?? ""}`),
      ...c.done_clusters.map((d) => `${d.ashkol} ${d.settlement_name}`),
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
              placeholder="שם, רכז על, מוסד, אשכול…"
            />
          </label>
        )}
        {!loading && filtered.length > 0 && (
          <section className="panel-form links-panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>רכז</th>
                    {showManagerCol && <th>רכז על</th>}
                    <th>יישוב</th>
                    <th>מוסדות</th>
                    <th>התקדמות</th>
                    <th>אשכולות שבוצעו</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div>{c.full_name}</div>
                        <div className="lede" style={{ margin: 0, fontSize: "0.85rem" }}>
                          {c.email}
                        </div>
                      </td>
                      {showManagerCol && <td>{c.manager_name || "—"}</td>}
                      <td>{c.settlement_name || "—"}</td>
                      <td>
                        {c.institutions.length
                          ? c.institutions.map((i) => i.name).join(" · ")
                          : "—"}
                      </td>
                      <td>
                        {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
                      </td>
                      <td>
                        {c.done_clusters.length === 0 ? (
                          "—"
                        ) : (
                          <span title={c.done_clusters.map((d) => d.ashkol).join(", ")}>
                            {c.done_clusters.length}
                            {c.done_clusters.length <= 3
                              ? ` (${c.done_clusters.map((d) => d.ashkol).join(", ")})`
                              : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
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
