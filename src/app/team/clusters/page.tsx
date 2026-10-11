"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { matchesSearch } from "@/lib/text-search";

type Row = {
  ashkol: string;
  settlement_name: string;
  bzb: number;
  turnout_pct: number;
  right_pct: number;
  likud_pct: number;
  institution_names: string;
  coordinator_names: string;
  linked: boolean;
  done: boolean;
};

export default function TeamClustersPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [linkFilter, setLinkFilter] = useState<"" | "linked" | "open">("");
  const [status, setStatus] = useState<"" | "open" | "done">("");
  const [minRight, setMinRight] = useState(0);
  const [maxTurnout, setMaxTurnout] = useState(100);
  const [minBzb, setMinBzb] = useState(0);
  const [minLikud, setMinLikud] = useState(0);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");
  const [busyAshkol, setBusyAshkol] = useState<string | null>(null);

  const load = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => r.json());
    const role = me.user?.role;
    if (role !== "super_admin" && role !== "area_manager") {
      router.replace("/");
      return;
    }
    const res = await fetch("/api/team/clusters");
    const data = await res.json();
    if (!res.ok) {
      setMsgKind("err");
      setMsg(data.error || "שגיאה");
      setLoading(false);
      return;
    }
    setRows(data.clusters ?? []);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (linkFilter === "linked" && !r.linked) return false;
      if (linkFilter === "open" && r.linked) return false;
      if (status === "done" && !r.done) return false;
      if (status === "open" && r.done) return false;
      if (r.right_pct < minRight) return false;
      if (r.turnout_pct > maxTurnout) return false;
      if (r.bzb < minBzb) return false;
      if ((r.likud_pct ?? 0) < minLikud) return false;
      const needle = q.trim();
      if (!needle) return true;
      const hay = [
        r.ashkol,
        r.settlement_name,
        r.institution_names,
        r.coordinator_names,
        formatAshkolLabel(r.ashkol, r.settlement_name),
        r.linked ? "מקושר" : "לא מקושר",
        r.done ? "בוצע" : "לא בוצע",
      ]
        .filter(Boolean)
        .join(" ");
      return matchesSearch(hay, needle);
    });
  }, [
    rows,
    q,
    linkFilter,
    status,
    minRight,
    maxTurnout,
    minBzb,
    minLikud,
  ]);

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

  function resetFilters() {
    setQ("");
    setLinkFilter("");
    setStatus("");
    setMinRight(0);
    setMaxTurnout(100);
    setMinBzb(0);
    setMinLikud(0);
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>אשכולות</h1>
            <p className="lede">
              כל האשכולות במערכת — סננו לפי קישור, סטטוס ומצביעים, וסמנו בוצע /
              לא בוצע.
            </p>
          </div>
        </header>
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && (
          <p
            className={`form-msg ${msgKind === "ok" ? "form-msg-ok" : "form-msg-err"}`}
            role="status"
          >
            {msg}
          </p>
        )}
        {!loading && (
          <div className="panel-form team-clusters-filters">
            <label>
              חיפוש
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="אשכול, יישוב, מוסד, רכז…"
              />
            </label>
            <label>
              קישור
              <select
                value={linkFilter}
                onChange={(e) =>
                  setLinkFilter(e.target.value as "" | "linked" | "open")
                }
              >
                <option value="">הכל</option>
                <option value="linked">מקושר למוסד</option>
                <option value="open">לא מקושר</option>
              </select>
            </label>
            <label>
              סטטוס
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "" | "open" | "done")
                }
              >
                <option value="">הכל</option>
                <option value="open">לא בוצע</option>
                <option value="done">בוצע</option>
              </select>
            </label>
            <label>
              מינימום % ימין
              <input
                type="number"
                min={0}
                max={100}
                value={minRight}
                onChange={(e) => setMinRight(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              מקסימום % הצבעה
              <input
                type="number"
                min={0}
                max={100}
                value={maxTurnout}
                onChange={(e) => setMaxTurnout(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              מינימום בז״ב
              <input
                type="number"
                min={0}
                value={minBzb}
                onChange={(e) => setMinBzb(Number(e.target.value) || 0)}
              />
            </label>
            <label>
              מינימום % מחל
              <input
                type="number"
                min={0}
                max={100}
                value={minLikud}
                onChange={(e) => setMinLikud(Number(e.target.value) || 0)}
              />
            </label>
            <div className="form-actions" style={{ alignSelf: "end" }}>
              <button type="button" className="reset" onClick={resetFilters}>
                נקה פילטרים
              </button>
            </div>
          </div>
        )}
        {!loading && filtered.length > 0 && (
          <div className="table-wrap table-compact">
            <table>
              <thead>
                <tr>
                  <th>אשכול</th>
                  <th>קישור</th>
                  <th>מוסד</th>
                  <th>רכז</th>
                  <th>% ימין</th>
                  <th>% מחל</th>
                  <th>% הצבעה</th>
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.ashkol}>
                    <td className="mono">
                      {formatAshkolLabel(r.ashkol, r.settlement_name)}
                    </td>
                    <td>{r.linked ? "מקושר" : "לא מקושר"}</td>
                    <td>{r.institution_names || "—"}</td>
                    <td>{r.coordinator_names || "—"}</td>
                    <td>{r.right_pct.toFixed(1)}%</td>
                    <td>{(r.likud_pct ?? 0).toFixed(1)}%</td>
                    <td>{r.turnout_pct.toFixed(1)}%</td>
                    <td>{r.done ? "בוצע ✓" : "לא בוצע"}</td>
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
                    </td>
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
          <p className="lede">
            {rows.length === 0
              ? "אין אשכולות להצגה"
              : "אין תוצאות לפילטר הנוכחי — נסו חיפוש או פילטר אחר"}
          </p>
        )}
      </div>
    </main>
  );
}
