"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LinksNav } from "@/components/LinksNav";

type LinkedCluster = {
  ashkol: string;
  settlement_name: string;
  right_pct: number;
  turnout_pct: number;
  bzb: number;
};

type Institution = {
  id: number;
  name: string;
  kind: string | null;
  settlement_name: string | null;
  linked_clusters?: LinkedCluster[] | string;
};

function parseClusters(value: LinkedCluster[] | string | undefined): LinkedCluster[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as LinkedCluster[];
  return value;
}

export default function InstitutionClustersLinksPage() {
  const router = useRouter();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [q, setQ] = useState("");
  const [ashkolDraft, setAshkolDraft] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [meRes, instRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/institutions"),
    ]);
    const me = await meRes.json();
    const role = me.user?.role;
    if (role !== "super_admin" && role !== "area_manager") {
      router.replace("/");
      return;
    }
    const data = await instRes.json();
    if (!instRes.ok) {
      setMsg(data.error || "אין הרשאה");
      setInstitutions([]);
      setLoading(false);
      return;
    }
    setInstitutions(
      (data.institutions ?? []).map((i: Institution) => ({
        ...i,
        linked_clusters: parseClusters(i.linked_clusters),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function linkAshkol(institutionId: number) {
    const ashkol = (ashkolDraft[institutionId] ?? "").trim();
    if (!ashkol) {
      setMsg("הזינו מספר אשכול");
      return;
    }
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בקישור");
        return;
      }
      setAshkolDraft((p) => ({ ...p, [institutionId]: "" }));
      setMsg(`אשכול ${ashkol} קושר למוסד`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function unlinkAshkol(institutionId: number, ashkol: string) {
    setBusyId(institutionId);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/institutions/${institutionId}/clusters?ashkol=${encodeURIComponent(ashkol)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה בהסרה");
        return;
      }
      setMsg(`אשכול ${ashkol} הוסר`);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const filtered = institutions.filter((i) => {
    const needle = q.trim();
    if (!needle) return true;
    const clusters = (i.linked_clusters as LinkedCluster[]) ?? [];
    const hay = [i.name, i.kind, i.settlement_name, ...clusters.map((c) => c.ashkol)]
      .filter(Boolean)
      .join(" ");
    return hay.includes(needle);
  });

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">קישורים</p>
            <h1>מוסד ↔ אשכולות</h1>
            <p className="lede">
              הוסיפו או הסירו אשכולות ממוסד. אחרי הקישור — בטבלת הרכז לחיצה על האשכול
              מציגה אותו במפה.
            </p>
          </div>
        </header>
        <LinksNav />
        {loading && <p className="lede">טוען…</p>}
        {!loading && msg && <p className="form-msg">{msg}</p>}
        {!loading && (
          <label className="panel-form" style={{ display: "block" }}>
            סינון
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="שם מוסד, יישוב, אשכול…"
            />
          </label>
        )}
        {!loading &&
          filtered.map((inst) => {
            const clusters = (inst.linked_clusters as LinkedCluster[]) ?? [];
            return (
              <section key={inst.id} className="panel-form links-panel">
                <div className="links-panel-head">
                  <h2>{inst.name}</h2>
                  <p className="lede">
                    {[inst.kind, inst.settlement_name].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                <div className="coord-link-add">
                  <input
                    dir="ltr"
                    placeholder="מספר אשכול"
                    value={ashkolDraft[inst.id] ?? ""}
                    onChange={(e) =>
                      setAshkolDraft((p) => ({ ...p, [inst.id]: e.target.value }))
                    }
                    disabled={busyId === inst.id}
                  />
                  <button
                    type="button"
                    className="export"
                    disabled={busyId === inst.id || !(ashkolDraft[inst.id] ?? "").trim()}
                    onClick={() => void linkAshkol(inst.id)}
                  >
                    קשר אשכול
                  </button>
                </div>
                {clusters.length === 0 ? (
                  <p className="lede" style={{ marginTop: "0.75rem" }}>
                    אין אשכולות מקושרים
                  </p>
                ) : (
                  <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>אשכול</th>
                          <th>יישוב</th>
                          <th>% ימין</th>
                          <th>הצבעה</th>
                          <th>בז״ב</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusters.map((c) => (
                          <tr key={c.ashkol}>
                            <td className="mono">{c.ashkol}</td>
                            <td>{c.settlement_name}</td>
                            <td>{Number(c.right_pct).toFixed(1)}</td>
                            <td>{Number(c.turnout_pct).toFixed(1)}</td>
                            <td>{c.bzb}</td>
                            <td>
                              <button
                                type="button"
                                className="linkish"
                                disabled={busyId === inst.id}
                                onClick={() => void unlinkAshkol(inst.id, c.ashkol)}
                              >
                                הסר
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
      </div>
    </main>
  );
}
