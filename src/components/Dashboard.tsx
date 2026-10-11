"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ClusterTable, type ClusterView } from "./ClusterTable";
import { downloadClustersCsv } from "@/lib/csv";

const StreetMap = dynamic(
  () => import("./StreetMap").then((m) => m.StreetMap),
  { ssr: false, loading: () => <div className="map-shell map-loading">טוען מפה…</div> },
);

type SortKey =
  | "settlement_name"
  | "ashkol"
  | "bzb"
  | "voters"
  | "turnout_pct"
  | "right_pct"
  | "right_votes";

export function Dashboard() {
  const [minRight, setMinRight] = useState(70);
  const [maxTurnout, setMaxTurnout] = useState(60);
  const [minBzb, setMinBzb] = useState(300);
  const [sort, setSort] = useState<SortKey>("right_pct");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [clusters, setClusters] = useState<ClusterView[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ lat: number; lng: number } | null>(null);
  const [selectedAshkol, setSelectedAshkol] = useState("");
  const [tableFocusToken, setTableFocusToken] = useState(0);
  const [role, setRole] = useState<string | null>(null);

  const isCoordinator = role === "coordinator";
  const effectiveMinRight = isCoordinator ? 0 : minRight;
  const effectiveMaxTurnout = isCoordinator ? 100 : maxTurnout;
  const effectiveMinBzb = isCoordinator ? 0 : minBzb;

  const load = useCallback(async () => {
    if (role === null) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        minRight: String(effectiveMinRight),
        maxTurnout: String(effectiveMaxTurnout),
        minBzb: String(effectiveMinBzb),
        sort,
        dir,
      });
      const res = await fetch(`/api/clusters?${q}`);
      if (!res.ok) throw new Error(`שגיאת שרת ${res.status}`);
      const data = await res.json();
      setClusters(data.clusters);
      setCount(data.count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "שגיאה בטעינה");
    } finally {
      setLoading(false);
    }
  }, [role, effectiveMinRight, effectiveMaxTurnout, effectiveMinBzb, sort, dir]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setRole(d.user?.role ?? "");
        if (d.settlement?.lat != null && d.settlement?.lng != null) {
          setFocus({ lat: Number(d.settlement.lat), lng: Number(d.settlement.lng) });
        }
      })
      .catch(() => {
        setRole("");
        setFocus(null);
      });
  }, []);

  function onSort(key: SortKey) {
    if (key === sort) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "settlement_name" || key === "ashkol" ? "asc" : "desc");
    }
  }

  const withMap = clusters.filter((c) => c.map_lat != null).length;

  return (
    <div className="dash">
      <header className="hero">
        <div>
          <p className="eyebrow">ניהול יום בחירות</p>
          <h1>אשכולות לפי הצבעה וימין</h1>
          <p className="lede">
            {isCoordinator
              ? "מפת הרחובות והאשכולות של המוסד. לחצו על נקודה לנתוני הבוחרים ועל קו רחוב לסימון בוצע."
              : "מפת הרחובות והאשכולות יחד. הסינון (ימין, הצבעה, בז״ב) חל על הנקודות, הטבלה והייצוא. לחצו על נקודה לנתוני הבוחרים ועל קו רחוב לסימון בוצע."}
          </p>
        </div>
        <div className="stats">
          <div>
            <span className="stat-n">{loading ? "…" : count}</span>
            <span className="stat-l">אשכולות</span>
          </div>
          <div>
            <span className="stat-n">{loading ? "…" : withMap}</span>
            <span className="stat-l">על המפה</span>
          </div>
        </div>
      </header>

      {role !== null && !isCoordinator && (
        <section className="filters">
          <label>
            מינימום % ימין
            <input
              type="range"
              min={0}
              max={100}
              value={minRight}
              onChange={(e) => setMinRight(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={minRight}
              onChange={(e) => setMinRight(Number(e.target.value))}
            />
          </label>
          <label>
            מקסימום % הצבעה
            <input
              type="range"
              min={0}
              max={100}
              value={maxTurnout}
              onChange={(e) => setMaxTurnout(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={maxTurnout}
              onChange={(e) => setMaxTurnout(Number(e.target.value))}
            />
          </label>
          <label>
            מינימום בז״ב
            <input
              type="range"
              min={0}
              max={5000}
              step={50}
              value={minBzb}
              onChange={(e) => setMinBzb(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              step={50}
              value={minBzb}
              onChange={(e) => setMinBzb(Number(e.target.value))}
            />
          </label>
          <div className="filter-actions">
            <button
              type="button"
              className="reset"
              onClick={() => {
                setMinRight(70);
                setMaxTurnout(60);
                setMinBzb(300);
              }}
            >
              ברירת מחדל 70 / 60 / 300
            </button>
            <button
              type="button"
              className="export"
              disabled={loading || clusters.length === 0}
              onClick={() =>
                downloadClustersCsv(
                  clusters,
                  `ashkolot-yamin${minRight}-turnout${maxTurnout}-bzb${minBzb}.csv`,
                )
              }
            >
              ייצוא CSV ({loading ? "…" : clusters.length})
            </button>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {!loading && !error && count === 0 && (
        <p className="lede" style={{ color: "var(--sand)" }}>
          אין אשכולות להצגה. לרכז: יש לשייך מוסד למשתמש ואז במפה ללחוץ «קשר למוסד»
          על האשכולות הרלוונטיים — רק הם יופיעו כאן.
        </p>
      )}

      <div className="unified">
        <StreetMap
          clusters={clusters}
          focus={focus}
          focusAshkol={selectedAshkol || null}
          focusAshkolToken={tableFocusToken}
        />
        <ClusterTable
          clusters={clusters}
          sort={sort}
          dir={dir}
          onSort={onSort}
          selectedAshkol={selectedAshkol}
          onSelect={(c) => {
            setSelectedAshkol(c.ashkol);
            setTableFocusToken((n) => n + 1);
          }}
        />
      </div>
    </div>
  );
}
