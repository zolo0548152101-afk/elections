"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatAshkolLabel } from "@/lib/ashkol-label";
import { ShowMore } from "@/components/ShowMore";
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
  const [status, setStatus] = useState<"" | "open" | "done">("");
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

  const filtered = rows.filter((r) => {
    if (status === "done" && !r.done) return false;
    if (status === "open" && r.done) return false;
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      r.ashkol,
      r.settlement_name,
      r.institution_name,
      r.coordinator_names,
      formatAshkolLabel(r.ashkol, r.settlement_name),
      r.done ? "בוצע" : "לא בוצע",
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
            <p className="eyebrow">ניהול</p>
            <h1>אשכולות</h1>
            <p className="lede">
              אשכולות שקושרו למוסד — סננו לפי סטטוס וסמנו בוצע / לא בוצע.
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
                  setStatus(e.target.value as "" | "open" | "done")
                }
              >
                <option value="">הכל</option>
                <option value="open">לא בוצע</option>
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
                  <th>סטטוס</th>
                  <th>פעולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={`${r.ashkol}:${r.institution_id}`}>
                    <td className="mono">
                      <ShowMore
                        text={formatAshkolLabel(r.ashkol, r.settlement_name)}
                      />
                    </td>
                    <td>
                      <ShowMore text={r.institution_name} />
                    </td>
                    <td>
                      <ShowMore text={r.coordinator_names} />
                    </td>
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
              : "אין תוצאות לפילטר הנוכחי — נסו חיפוש או סטטוס אחר"}
          </p>
        )}
      </div>
    </main>
  );
}
