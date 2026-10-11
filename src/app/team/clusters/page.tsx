"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { matchesSearch } from "@/lib/text-search";

type Row = {
  ashkol: string;
  settlement_name: string;
  institution_id: number;
  institution_name: string;
  coordinator_names: string;
  done: boolean;
};

export default function TeamClustersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | "linked" | "done">("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      const role = me.user?.role;
      if (role !== "super_admin" && role !== "area_manager") {
        router.replace("/");
        return;
      }
      const res = await fetch("/api/team/clusters");
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        setLoading(false);
        return;
      }
      setRows(data.clusters ?? []);
      setLoading(false);
    })();
  }, [router]);

  const filtered = rows.filter((r) => {
    if (status === "done" && !r.done) return false;
    if (status === "linked" && r.done) return false;
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      r.ashkol,
      r.settlement_name,
      r.institution_name,
      r.coordinator_names,
      formatAshkolLabel(r.ashkol, r.settlement_name),
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
            <h1>אשכולות</h1>
            <p className="lede">אשכולות שקושרו למוסד — או שסומנו כבוצעו.</p>
          </div>
        </header>
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && (
          <div className="panel-form users-filters">
            <label>
              חיפוש
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="אשכול, יישוב, מוסד, רכז…"
              />
            </label>
            <label>
              סטטוס
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "" | "linked" | "done")
                }
              >
                <option value="">הכל</option>
                <option value="linked">קושר</option>
                <option value="done">בוצע</option>
              </select>
            </label>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="table-wrap table-compact">
            <table>
              <thead>
                <tr>
                  <th>אשכול</th>
                  <th>מוסד</th>
                  <th>רכז</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.ashkol}:${r.institution_id}`}>
                    <td className="mono" title={r.done ? "בוצע" : "קושר"}>
                      {formatAshkolLabel(r.ashkol, r.settlement_name)}
                      {r.done ? " ✓" : ""}
                    </td>
                    <td>{r.institution_name || "—"}</td>
                    <td>{r.coordinator_names || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              {filtered.length} / {rows.length}
            </p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="lede">אין אשכולות להצגה</p>
        )}
      </div>
    </main>
  );
}
