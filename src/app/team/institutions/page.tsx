"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Inst = {
  id: number;
  name: string;
  kind: string | null;
  settlement_name: string | null;
  district: string | null;
  coordinator_count: number;
  cluster_count: number;
  coordinators?: { id: number; full_name: string }[] | string;
};

function parseCoords(
  value: { id: number; full_name: string }[] | string | undefined,
) {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as { id: number; full_name: string }[];
  return value;
}

export default function TeamInstitutionsPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Inst[]>([]);
  const [q, setQ] = useState("");
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
      const res = await fetch("/api/team/institutions");
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        setLoading(false);
        return;
      }
      setRows(
        (data.institutions ?? []).map((i: Inst) => ({
          ...i,
          coordinators: parseCoords(i.coordinators),
        })),
      );
      setLoading(false);
    })();
  }, [router]);

  const filtered = rows.filter((i) => {
    const needle = q.trim();
    if (!needle) return true;
    const coords = (i.coordinators as { full_name: string }[]) ?? [];
    const hay = [i.name, i.kind, i.settlement_name, i.district, ...coords.map((c) => c.full_name)]
      .filter(Boolean)
      .join(" ");
    return hay.includes(needle);
  });

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">הצוות</p>
            <h1>מוסדות הצוות</h1>
            <p className="lede">
              מוסדות המקושרים לרכזים שלכם (רכז יכול להיות משויך לכמה מוסדות).
            </p>
          </div>
        </header>
        <nav className="links-subnav" aria-label="הצוות">
          <Link href="/team/coordinators">רכזים</Link>
          <Link href="/team/institutions" className="active">
            מוסדות הצוות
          </Link>
        </nav>
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && (
          <label className="panel-form" style={{ display: "block" }}>
            חיפוש
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="מוסד, יישוב, רכז…"
            />
          </label>
        )}
        {!loading && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>סוג</th>
                  <th>יישוב</th>
                  <th>מחוז</th>
                  <th>רכזים</th>
                  <th>אשכולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const coords = (i.coordinators as { id: number; full_name: string }[]) ?? [];
                  return (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.kind || "—"}</td>
                      <td>{i.settlement_name || "—"}</td>
                      <td>{i.district || "—"}</td>
                      <td>
                        {coords.length
                          ? coords.map((c) => c.full_name).join(" · ")
                          : "—"}
                      </td>
                      <td>{i.cluster_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              {filtered.length} / {rows.length} מוסדות
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
