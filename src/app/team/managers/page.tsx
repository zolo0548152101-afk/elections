"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Coord = {
  id: number;
  full_name: string;
  email: string;
  settlement_name: string | null;
  institution_names: string;
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

export default function TeamManagersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Manager[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = await fetch("/api/auth/me").then((r) => r.json());
      if (me.user?.role !== "super_admin") {
        router.replace("/team/coordinators");
        return;
      }
      const res = await fetch("/api/team/managers");
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        setLoading(false);
        return;
      }
      setRows(data.managers ?? []);
      setLoading(false);
    })();
  }, [router]);

  const filtered = rows.filter((m) => {
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      m.full_name,
      m.email,
      m.mobile,
      ...m.coordinators.flatMap((c) => [
        c.full_name,
        c.settlement_name,
        c.institution_names,
      ]),
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
            <h1>רכזי על</h1>
            <p className="lede">
              כל רכזי העל והרכזים המשויכים אליהם — עם התקדמות סימון הרחובות.
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
              placeholder="רכז על, רכז, מוסד…"
            />
          </label>
        )}
        {!loading &&
          filtered.map((m) => (
            <section key={m.id} className="panel-form links-panel">
              <div className="links-panel-head">
                <h2>{m.full_name}</h2>
                <p className="lede">
                  {[m.email, m.mobile, `${m.coordinator_count} רכזים`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {m.coordinators.length === 0 ? (
                <p className="lede">אין רכזים משויכים</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>רכז</th>
                        <th>יישוב</th>
                        <th>מוסדות</th>
                        <th>התקדמות</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.coordinators.map((c) => (
                        <tr key={c.id}>
                          <td>{c.full_name}</td>
                          <td>{c.settlement_name || "—"}</td>
                          <td>{c.institution_names || "—"}</td>
                          <td>
                            {c.progress.done}/{c.progress.total} ({c.progress.pct}%)
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
          <p className="lede">אין רכזי על במערכת</p>
        )}
      </div>
    </main>
  );
}
