"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AshkolSearch } from "@/components/AshkolSearch";
import { LinksNav } from "@/components/LinksNav";
import { ShowMore } from "@/components/ShowMore";
import { matchesSearch } from "@/lib/text-search";

type LinkedCluster = {
  ashkol: string;
  settlement_name: string;
  right_pct: number;
  turnout_pct: number;
  bzb: number;
  street_total?: number;
  street_done?: number;
  done?: boolean;
};

type Institution = {
  id: number;
  name: string;
  kind: string | null;
  settlement_name: string | null;
  contacts?: { full_name?: string; phone?: string }[] | string;
  linked_clusters?: LinkedCluster[] | string;
};

function parseClusters(value: LinkedCluster[] | string | undefined): LinkedCluster[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as LinkedCluster[];
  return value;
}

function parseContacts(
  value: Institution["contacts"],
): { full_name?: string; phone?: string }[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as { full_name?: string; phone?: string }[];
    } catch {
      return [];
    }
  }
  return value;
}

export default function InstitutionClustersLinksPage() {
  const router = useRouter();
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [q, setQ] = useState("");
  const [ashkolPick, setAshkolPick] = useState<Record<number, string>>({});
  const [pickerEpoch, setPickerEpoch] = useState<Record<number, number>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgKind, setMsgKind] = useState<"ok" | "err">("ok");
  const [flashId, setFlashId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(opts?: { quiet?: boolean }) {
    if (!opts?.quiet) setLoading(true);
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
      setMsgKind("err");
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
    const ashkol = (ashkolPick[institutionId] ?? "").trim();
    if (!ashkol) {
      setMsgKind("err");
      setMsg("בחרו אשכול מהחיפוש");
      return;
    }
    setBusyId(institutionId);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/clusters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ashkol }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsgKind("err");
        setMsg(data.error || "שגיאה בקישור");
        return;
      }
      const instName =
        institutions.find((i) => i.id === institutionId)?.name ?? "המוסד";
      setAshkolPick((p) => ({ ...p, [institutionId]: "" }));
      setPickerEpoch((p) => ({ ...p, [institutionId]: (p[institutionId] ?? 0) + 1 }));
      setMsgKind("ok");
      setMsg(`✓ הקישור הצליח — אשכול ${ashkol} קושר ל«${instName}»`);
      setFlashId(institutionId);
      window.setTimeout(() => setFlashId((id) => (id === institutionId ? null : id)), 4000);
      await load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  async function unlinkAshkol(institutionId: number, ashkol: string) {
    setBusyId(institutionId);
    try {
      const res = await fetch(
        `/api/institutions/${institutionId}/clusters?ashkol=${encodeURIComponent(ashkol)}`,
        { method: "DELETE" },
      );
      const data = await res.json();
      if (!res.ok) {
        setMsgKind("err");
        setMsg(data.error || "שגיאה בהסרה");
        return;
      }
      setMsgKind("ok");
      setMsg(`אשכול ${ashkol} הוסר מהמוסד`);
      await load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim();
    if (!needle) return institutions;
    return institutions.filter((i) => {
      const clusters = (i.linked_clusters as LinkedCluster[]) ?? [];
      const contacts = parseContacts(i.contacts);
      const hay = [
        i.name,
        i.kind,
        i.settlement_name,
        ...clusters.map((c) => `${c.ashkol} ${c.settlement_name}`),
        ...contacts.map((c) => `${c.full_name ?? ""} ${c.phone ?? ""}`),
      ]
        .filter(Boolean)
        .join(" ");
      return matchesSearch(hay, needle);
    });
  }, [institutions, q]);

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">קישורים</p>
            <h1>מוסד ↔ אשכולות</h1>
            <p className="lede">
              חפשו לפי כל חלק משם המוסד, יישוב או אשכול. אחרי קישור מוצלח תופיע הודעת
              אישור, ואשכולות שבוצעו מסומנים.
            </p>
          </div>
        </header>
        <LinksNav />
        {loading && <p className="lede">טוען…</p>}
        {msg && (
          <p className={`form-msg ${msgKind === "ok" ? "form-msg-ok" : "form-msg-err"}`}>
            {msg}
          </p>
        )}
        {!loading && (
          <label className="panel-form" style={{ display: "block" }}>
            חיפוש מוסד
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="כל חלק מהשם, יישוב, איש קשר או אשכול…"
              autoComplete="off"
            />
          </label>
        )}
        {!loading && filtered.length === 0 && (
          <p className="lede">אין מוסדות התואמים לחיפוש</p>
        )}
        {!loading &&
          filtered.map((inst) => {
            const clusters = (inst.linked_clusters as LinkedCluster[]) ?? [];
            return (
              <section
                key={inst.id}
                className={`panel-form links-panel${flashId === inst.id ? " links-panel-flash" : ""}`}
              >
                <div className="links-panel-head">
                  <h2>
                    <ShowMore text={inst.name} />
                  </h2>
                  <p className="lede">
                    <ShowMore
                      text={
                        [inst.kind, inst.settlement_name].filter(Boolean).join(" · ") || ""
                      }
                    />
                  </p>
                </div>
                <div className="coord-cluster-add">
                  <label>
                    אשכול
                    <AshkolSearch
                      key={`${inst.id}:${pickerEpoch[inst.id] ?? 0}`}
                      disabled={busyId === inst.id}
                      onPick={(code) =>
                        setAshkolPick((p) => ({ ...p, [inst.id]: code }))
                      }
                      onSubmit={() => void linkAshkol(inst.id)}
                    />
                  </label>
                  <button
                    type="button"
                    className="export"
                    disabled={busyId === inst.id || !(ashkolPick[inst.id] ?? "").trim()}
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
                          <th>סטטוס</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusters.map((c) => (
                          <tr key={c.ashkol}>
                            <td className="mono">{c.ashkol}</td>
                            <td>
                              <ShowMore text={c.settlement_name} />
                            </td>
                            <td>{Number(c.right_pct).toFixed(1)}</td>
                            <td>{Number(c.turnout_pct).toFixed(1)}</td>
                            <td>{c.bzb}</td>
                            <td>
                              {c.done ? (
                                <span className="status-pill status-done">בוצע</span>
                              ) : (c.street_total ?? 0) > 0 ? (
                                <span className="status-pill status-open">
                                  {c.street_done ?? 0}/{c.street_total} רחובות
                                </span>
                              ) : (
                                <span className="status-pill status-open">מקושר</span>
                              )}
                            </td>
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
