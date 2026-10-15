"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clusterStage, type ClusterStage } from "@/lib/cluster-stage";
import { StageTabs, stageCounts } from "@/components/StageTabs";
import { ClusterTable, type ClusterView } from "./ClusterTable";
import { downloadClustersCsv } from "@/lib/csv";
import { PageQuip } from "@/components/PageQuip";
import { matchesSearch } from "@/lib/text-search";

const StreetMap = dynamic(
  () => import("./StreetMap").then((m) => m.StreetMap),
  {
    ssr: false,
    loading: () => (
      <div
        className="map-shell map-loading skeleton skeleton-block"
        aria-busy="true"
        aria-label="טוען מפה"
      />
    ),
  },
);

type SortKey =
  | "settlement_name"
  | "ashkol"
  | "bzb"
  | "voters"
  | "turnout_pct"
  | "right_pct"
  | "right_votes"
  | "likud_pct"
  | "likud_votes";

export function Dashboard() {
  const [minRight, setMinRight] = useState(0);
  const [maxTurnout, setMaxTurnout] = useState(100);
  const [minBzb, setMinBzb] = useState(0);
  const [minLikud, setMinLikud] = useState(0);
  const [stageFilter, setStageFilter] = useState<"any" | ClusterStage>("any");
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
  const [tableQuery, setTableQuery] = useState("");

  const isCoordinator = role === "coordinator";
  const effectiveMinRight = isCoordinator ? 0 : minRight;
  const effectiveMaxTurnout = isCoordinator ? 100 : maxTurnout;
  const effectiveMinBzb = isCoordinator ? 0 : minBzb;
  const effectiveMinLikud = isCoordinator ? 0 : minLikud;

  const load = useCallback(async () => {
    if (role === null) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({
        minRight: String(effectiveMinRight),
        maxTurnout: String(effectiveMaxTurnout),
        minBzb: String(effectiveMinBzb),
        minLikud: String(effectiveMinLikud),
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
  }, [
    role,
    effectiveMinRight,
    effectiveMaxTurnout,
    effectiveMinBzb,
    effectiveMinLikud,
    sort,
    dir,
  ]);

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

  const stageOf = (c: ClusterView) => clusterStage(Boolean(c.done), c.street_done ?? 0);
  const counts = useMemo(() => stageCounts(clusters, stageOf), [clusters]);
  const openClusters = useMemo(() => {
    if (stageFilter === "any") return clusters;
    return clusters.filter((c) => stageOf(c) === stageFilter);
  }, [clusters, stageFilter]);
  const tableClusters = useMemo(() => {
    const q = tableQuery.trim();
    if (!q) return openClusters;
    return openClusters.filter((c) => matchesSearch(`${c.settlement_name} ${c.ashkol}`, q));
  }, [openClusters, tableQuery]);
  const slidersChanged = minRight !== 0 || maxTurnout !== 100 || minBzb !== 0 || minLikud !== 0;

  function onClusterDone(ashkol: string, done: boolean) {
    setClusters((prev) =>
      prev.map((c) => (c.ashkol === ashkol ? { ...c, done } : c)),
    );
  }

  const withMap = clusters.filter((c) => c.map_lat != null).length;
  const linkedCount = clusters.filter((c) => c.linked).length;
  const doneCount = clusters.filter((c) => c.done).length;

  return (
    <div className="dash">
      <header className="hero">
        <div>
          <h1>אשכולות לפי הצבעה וימין</h1>
            <PageQuip />
        </div>
        <div className="stats">
          <div>
            <span className="stat-n">{loading ? "…" : withMap}</span>
            <span className="stat-l">על המפה</span>
          </div>
          <div>
            <span className="stat-n">
              {loading ? "…" : `${linkedCount}/${count || 0}`}
            </span>
            <span className="stat-l">תואמו</span>
          </div>
          <div>
            <span className="stat-n">
              {loading ? "…" : `${doneCount}/${count || 0}`}
            </span>
            <span className="stat-l">בוצעו</span>
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
          <label>
            מינימום % מחל (ליכוד)
            <input
              type="range"
              min={0}
              max={100}
              value={minLikud}
              onChange={(e) => setMinLikud(Number(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={100}
              value={minLikud}
              onChange={(e) => setMinLikud(Number(e.target.value))}
            />
          </label>
          <div className="filter-actions">
            {slidersChanged ? (
              <button
                type="button"
                className="filters-reset"
                onClick={() => {
                  setMinRight(0);
                  setMaxTurnout(100);
                  setMinBzb(0);
                  setMinLikud(0);
                }}
              >
                איפוס מסננים
              </button>
            ) : null}
            <button
              type="button"
              className="export"
              disabled={loading || clusters.length === 0}
              onClick={() =>
                downloadClustersCsv(
                  clusters,
                  `ashkolot-yamin${minRight}-turnout${maxTurnout}-bzb${minBzb}-likud${minLikud}.csv`,
                )
              }
            >
              ייצוא CSV ({loading ? "…" : clusters.length})
            </button>
          </div>
        </section>
      )}

      {role !== null && (
        <section className="stage-bar" aria-label="מצב ביצוע">
          <StageTabs value={stageFilter} onChange={setStageFilter} counts={counts} />
        </section>
      )}

      {error && (
        <p className="error" role="alert" aria-live="assertive">
          {error}
        </p>
      )}
      {!loading && !error && openClusters.length === 0 && (
        <p className="lede" style={{ color: "var(--sand)" }}>
          {count > 0 && stageFilter !== "any"
            ? "אין אשכולות במצב הזה. בחרו «כל האשכולות» כדי לראות את כולם."
            : "אין אשכולות להצגה. לרכז: יש לשייך מוסד למשתמש ואז במפה ללחוץ «קשר למוסד» על האשכולות הרלוונטיים — רק הם יופיעו כאן."}
        </p>
      )}

      <div className="unified">
        <StreetMap
          clusters={openClusters}
          focus={isCoordinator ? null : focus}
          focusAshkol={selectedAshkol || null}
          focusAshkolToken={tableFocusToken}
          onClusterDone={onClusterDone}
        />
        {role !== null && !isCoordinator && (
          <div className="table-search">
            <label>
              <span>חיפוש בטבלה</span>
              <input
                type="search"
                value={tableQuery}
                onChange={(e) => setTableQuery(e.target.value)}
                placeholder="שם יישוב או מספר אשכול"
              />
            </label>
            {tableQuery.trim() ? (
              <span className="table-search-count">
                {tableClusters.length} מתוך {openClusters.length}
              </span>
            ) : null}
          </div>
        )}
        <ClusterTable
          clusters={tableClusters}
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
