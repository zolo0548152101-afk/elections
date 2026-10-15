"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ClusterRowLinks, FirstClusterLink } from "@/components/ClusterLinks";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { ShowMore } from "@/components/ShowMore";
import { matchesSearch } from "@/lib/text-search";
import { CLUSTER_STAGE_LABEL, clusterStage, type ClusterStage } from "@/lib/cluster-stage";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";
import { Quip } from "@/components/Quip";
import { LOADING } from "@/lib/quips";
import { EMPTY_CLUSTERS, EMPTY_SEARCH } from "@/lib/quips";
import { PageQuip } from "@/components/PageQuip";

type Coord = { id: number; full_name: string };

type Row = {
  ashkol: string;
  settlement_name: string;
  institution_id: number | null;
  institution_name: string;
  coordinator_names: string;
  coordinators: Coord[];
  done: boolean;
  street_total: number;
  street_done: number;
};

type ScopeFilter = "linked" | "all";
type StageFilter = "any" | ClusterStage;

const APP_TEAM_CLUSTERS_SORT: SortGetters<Row, "ashkol" | "inst" | "coord" | "stage"> = {
  ashkol: (r) => formatAshkolLabel(r.ashkol, r.settlement_name),
  inst: (r) => r.institution_name,
  coord: (r) => r.coordinator_names,
  stage: (r) => clusterStage(r.done, r.street_done) === "done" ? 2 : r.street_done > 0 ? 1 + r.street_done / Math.max(1, r.street_total) : 0,
};

export default function TeamClustersPage() {
  const tsort = useSortState<"ashkol" | "inst" | "coord" | "stage">();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<ScopeFilter>("linked");
  const [stageFilter, setStageFilter] = useState<StageFilter>("any");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");
  const [busyAshkol, setBusyAshkol] = useState<string | null>(null);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [isCoordinator, setIsCoordinator] = useState(false);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true);
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const role = me.user?.role;
    if (role !== "super_admin" && role !== "area_manager" && role !== "coordinator") {
      router.replace("/");
      return;
    }
    setIsCoordinator(role === "coordinator");
    const scope = status === "all" ? "all" : "linked";
    const res = await fetch(`/api/team/clusters?scope=${scope}`);
    const data = await res.json();
    if (!res.ok) {
      setMsgKind("err");
      setMsg(data.error || "שגיאה");
      setLoading(false);
      return;
    }
    setRows(data.clusters ?? []);
    setLoading(false);
  }, [router, status]);

  const firstLoad = useRef(true);
  useEffect(() => {
    const quiet = !firstLoad.current;
    firstLoad.current = false;
    void load({ quiet });
  }, [load]);

  const filtered = rows.filter((r) => {
    if (stageFilter !== "any" && clusterStage(r.done, r.street_done) !== stageFilter) return false;
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      r.ashkol,
      r.settlement_name,
      r.institution_name,
      r.coordinator_names,
      formatAshkolLabel(r.ashkol, r.settlement_name),
      CLUSTER_STAGE_LABEL[clusterStage(r.done, r.street_done)],
    ]
      .filter(Boolean)
      .join(" ");
    return matchesSearch(hay, needle);
  });

  async function setDone(ashkol: string, done: boolean) {
    setBusyAshkol(ashkol);
    setMsg(null);
    try {
      const res = await fetch("/api/team/clusters/mark", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol, done }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgKind("err");
        setMsg(data.error || "שגיאה בעדכון סטטוס");
        return;
      }
      setRows((prev) =>
        prev.map((r) => (r.ashkol === ashkol ? { ...r, done } : r)),
      );
      setMsgKind("ok");
      setMsg(
        done
          ? `✓ אשכול ${ashkol} סומן כבוצע`
          : `אשכול ${ashkol} סומן כלא בוצע`,
      );
    } finally {
      setBusyAshkol(null);
    }
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <h1>אשכולות</h1>
            <PageQuip />
          </div>
        </header>
        {loading && <p className="lede"><Quip list={LOADING} /></p>}
        {!loading && msg && (
          <p
            className={`form-msg ${msgKind === "ok" ? "form-msg-ok" : "form-msg-err"}`}
            role="status"
          >
            {msg}
          </p>
        )}
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
            {!isCoordinator && (
            <label>
              אשכולות
              <select
                value={status}
                onChange={(e) => {
                  setEditKey(null);
                  setStatus(e.target.value as ScopeFilter);
                }}
              >
                <option value="linked">שקושרו למוסד</option>
                <option value="all">כולם</option>
              </select>
            </label>
            )}
            <label>
              מצב ביצוע
              <select
                value={stageFilter}
                onChange={(e) => {
                  setEditKey(null);
                  setStageFilter(e.target.value as StageFilter);
                }}
              >
                <option value="any">הכל</option>
                <option value="pending">{CLUSTER_STAGE_LABEL.pending} — אף רחוב לא סומן</option>
                <option value="partial">{CLUSTER_STAGE_LABEL.partial} — חלק מהרחובות סומנו</option>
                <option value="done">{CLUSTER_STAGE_LABEL.done} — כל הרחובות סומנו</option>
              </select>
            </label>
          </div>
        )}
        {!loading && !isCoordinator && (
          <FirstClusterLink
            onChanged={() => load({ quiet: true })}
            onMessage={(kind, text) => {
              setMsgKind(kind);
              setMsg(text);
            }}
          />
        )}
        {!loading && filtered.length > 0 && (
          <div className={`table-wrap table-compact${editKey ? " is-editing" : ""}`}>
            <table>
              <thead>
                <tr>
                  <SortTh k="ashkol" sort={tsort.sort} onSort={tsort.toggle}>אשכול</SortTh>
                  <SortTh k="inst" sort={tsort.sort} onSort={tsort.toggle}>מוסד</SortTh>
                  <SortTh k="coord" sort={tsort.sort} onSort={tsort.toggle}>רכז</SortTh>
                  <SortTh k="stage" sort={tsort.sort} onSort={tsort.toggle}>סטטוס</SortTh>
                  {!isCoordinator && <th>פעולות</th>}
                </tr>
              </thead>
              <tbody>
                {sortRows(filtered, APP_TEAM_CLUSTERS_SORT, tsort.sort).map((r) => {
                  const key = `${r.ashkol}:${r.institution_id ?? "none"}`;
                  const open = editKey === key;
                  const institutions = [
                    ...new Map(
                      rows
                        .filter((x) => x.ashkol === r.ashkol && x.institution_id != null)
                        .map((x) => [
                          x.institution_id as number,
                          { id: x.institution_id as number, name: x.institution_name },
                        ]),
                    ).values(),
                  ];
                  return (
                  <Fragment key={key}>
                  <tr className={open ? "row-editing" : undefined}>
                    <td className="mono">
                      <ShowMore
                        text={formatAshkolLabel(r.ashkol, r.settlement_name)}
                      />
                    </td>
                    <td>
                      {open ? (
                        <span className="muted-cell">נערך בשורה למטה</span>
                      ) : r.institution_name ? (
                        <ShowMore text={r.institution_name} />
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      {open ? (
                        <span className="muted-cell">נערך בשורה למטה</span>
                      ) : r.coordinator_names ? (
                        <ShowMore text={r.coordinator_names} />
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      {(() => {
                        const stage = clusterStage(r.done, r.street_done);
                        return (
                          <span className={`stage-badge is-${stage}`}>
                            {CLUSTER_STAGE_LABEL[stage]}
                            {r.street_total > 0 && (
                              <small dir="ltr">
                                {r.street_done}/{r.street_total}
                              </small>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    {!isCoordinator && (
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="export"
                        disabled={busyAshkol === r.ashkol || r.done}
                        onClick={() => void setDone(r.ashkol, true)}
                      >
                        {busyAshkol === r.ashkol && !r.done
                          ? "…"
                          : "סמן בוצע"}
                      </button>
                      <button
                        type="button"
                        className="reset"
                        disabled={busyAshkol === r.ashkol || !r.done}
                        onClick={() => void setDone(r.ashkol, false)}
                      >
                        {busyAshkol === r.ashkol && r.done
                          ? "…"
                          : "לא בוצע"}
                      </button>
                      <button
                        type="button"
                        className="export"
                        onClick={() => setEditKey((cur) => (cur === key ? null : key))}
                      >
                        {open ? "סגור" : "קשרים"}
                      </button>
                    </td>
                    )}
                  </tr>
                  {open && !isCoordinator && (
                    <tr className="edit-detail-row">
                      <td colSpan={5}>
                        <ClusterRowLinks
                          row={r}
                          institutions={institutions}
                          onChanged={() => load({ quiet: true })}
                          onMessage={(kind, text) => {
                            setMsgKind(kind);
                            setMsg(text);
                          }}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              {filtered.length} / {rows.length}
            </p>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <p className="lede">
            {rows.length === 0
              ? <Quip list={EMPTY_CLUSTERS} />
              : <Quip list={EMPTY_SEARCH} />}
          </p>
        )}
      </div>
    </main>
  );
}
