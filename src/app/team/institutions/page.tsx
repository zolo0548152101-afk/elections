"use client";

import { useEffect, useState } from "react";
import { ShowMore } from "@/components/ShowMore";
import { useRouter } from "next/navigation";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";

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

const APP_TEAM_INSTITUTIONS_SORT: SortGetters<Inst, "name" | "kind" | "city" | "district" | "coords" | "clusters"> = {
  name: (r) => r.name,
  kind: (r) => r.kind,
  city: (r) => r.settlement_name,
  district: (r) => r.district,
  coords: (r) => ((r.coordinators as { full_name: string }[]) ?? []).map((c) => c.full_name).join(" · "),
  clusters: (r) => Number(r.cluster_count ?? 0),
};

export default function TeamInstitutionsPage() {
  const tsort = useSortState<"name" | "kind" | "city" | "district" | "coords" | "clusters">();
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
            <p className="eyebrow">ניהול</p>
            <h1>מוסדות הצוות</h1>
            <p className="lede">
              מוסדות המקושרים לרכזים שלכם (רכז יכול להיות משויך לכמה מוסדות).
            </p>
          </div>
        </header>
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && (
          <label className="panel-form search-strip">
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
                  <SortTh k="name" sort={tsort.sort} onSort={tsort.toggle}>שם</SortTh>
                  <SortTh k="kind" sort={tsort.sort} onSort={tsort.toggle}>סוג</SortTh>
                  <SortTh k="city" sort={tsort.sort} onSort={tsort.toggle}>יישוב</SortTh>
                  <SortTh k="district" sort={tsort.sort} onSort={tsort.toggle}>מחוז</SortTh>
                  <SortTh k="coords" sort={tsort.sort} onSort={tsort.toggle}>רכזים</SortTh>
                  <SortTh k="clusters" sort={tsort.sort} onSort={tsort.toggle}>אשכולות</SortTh>
                </tr>
              </thead>
              <tbody>
                {sortRows(filtered, APP_TEAM_INSTITUTIONS_SORT, tsort.sort).map((i) => {
                  const coords = (i.coordinators as { id: number; full_name: string }[]) ?? [];
                  return (
                    <tr key={i.id}>
                      <td>
                        <ShowMore text={i.name} />
                      </td>
                      <td>
                        <ShowMore text={i.kind} />
                      </td>
                      <td>
                        <ShowMore text={i.settlement_name} />
                      </td>
                      <td>
                        <ShowMore text={i.district} />
                      </td>
                      <td>
                        <ShowMore
                          text={
                            coords.length
                              ? coords.map((c) => c.full_name).join(" · ")
                              : ""
                          }
                        />
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
