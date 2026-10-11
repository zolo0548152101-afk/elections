"use client";

import { useEffect, useState } from "react";

type Contact = {
  id: number;
  full_name: string;
  role_title: string;
  phone: string;
};

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
  district: string | null;
  lat: number | null;
  lng: number | null;
  key_people_raw: string | null;
  created_at: string;
  contacts?: Contact[] | string;
  linked_clusters?: LinkedCluster[] | string;
};

function parseJsonField<T>(value: T[] | string | undefined): T[] {
  if (!value) return [];
  if (typeof value === "string") return JSON.parse(value) as T[];
  return value;
}

export default function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  const canEdit = role === "super_admin" || role === "area_manager";
  const isCoordinator = role === "coordinator";

  async function load() {
    setLoading(true);
    const [instRes, meRes] = await Promise.all([
      fetch("/api/institutions"),
      fetch("/api/auth/me"),
    ]);
    const data = await instRes.json();
    const me = await meRes.json();
    setRole(me.user?.role ?? null);

    if (!instRes.ok) {
      setInfo(data.error || "אין הרשאה");
      setInstitutions([]);
      setLoading(false);
      return;
    }

    setInfo(data.message ?? null);
    setKinds(data.kinds ?? []);
    setInstitutions(
      (data.institutions ?? []).map((i: Institution) => ({
        ...i,
        contacts: parseJsonField<Contact>(i.contacts),
        linked_clusters: parseJsonField<LinkedCluster>(i.linked_clusters),
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/institutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, kind: kind || null }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      return;
    }
    setName("");
    setKind("");
    setMsg("נוסף");
    void load();
  }

  const filtered = institutions.filter((i) => {
    const needle = q.trim();
    if (!needle) return true;
    const hay = [i.name, i.kind, i.settlement_name, i.district, i.key_people_raw]
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
            <h1>{isCoordinator ? "המוסד שלי" : "מוסדות"}</h1>
            <p className="lede">
              {isCoordinator
                ? "המוסד המשויך אליך מחוברת2 — אשכולות מקושרים מופיעים במפה"
                : "קטלוג מחוברת2 — סוג, יישוב, מחוז, קואורדינטות ואנשי מפתח. רכזים משויכים דרך מסך משתמשים."}
            </p>
          </div>
        </header>

        {loading && <p className="lede">טוען…</p>}

        {!loading && info && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            {info}
          </p>
        )}

        {!loading && canEdit && (
          <>
            <form className="panel-form" onSubmit={onSubmit}>
              <div className="form-grid">
                <label>
                  שם מוסד
                  <input value={name} onChange={(e) => setName(e.target.value)} required />
                </label>
                <label>
                  סוג
                  <select value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">—</option>
                    {kinds.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="export">
                הוספה
              </button>
              {msg && <p>{msg}</p>}
            </form>
            <label className="panel-form" style={{ display: "block" }}>
              סינון
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="שם, יישוב, מחוז…"
              />
            </label>
          </>
        )}

        {!loading && isCoordinator && institutions.length === 0 && !info && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            לא שויך מוסד למשתמש זה — מנהל צריך לבחור מוסד במסך משתמשים.
          </p>
        )}

        {/* Coordinator / area-manager detail cards with linked clusters */}
        {!loading && (isCoordinator || role === "area_manager") &&
          institutions.map((inst) => {
            const contacts = (inst.contacts ?? []) as Contact[];
            const clusters = (inst.linked_clusters ?? []) as LinkedCluster[];
            return (
              <section
                key={inst.id}
                className="panel-form"
                style={{ marginBottom: "1.25rem" }}
              >
                <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.25rem" }}>{inst.name}</h2>
                <p className="lede" style={{ marginBottom: "0.75rem" }}>
                  {[inst.kind, inst.settlement_name, inst.district]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
                {contacts.length > 0 && (
                  <div style={{ marginBottom: "1rem" }}>
                    <strong>אנשי מפתח</strong>
                    <ul style={{ margin: "0.35rem 0 0", paddingInlineStart: "1.2rem" }}>
                      {contacts.map((c) => (
                        <li key={c.id}>
                          {c.full_name}
                          {c.role_title ? ` (${c.role_title})` : ""}
                          {c.phone ? ` · ${c.phone}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <strong>אשכולות מקושרים ({clusters.length})</strong>
                {clusters.length === 0 ? (
                  <p className="lede" style={{ marginTop: "0.35rem" }}>
                    עדיין אין אשכולות — במפה לחצו על אשכול ואז «קשר למוסד».
                  </p>
                ) : (
                  <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
                    <table>
                      <thead>
                        <tr>
                          <th>אשכול</th>
                          <th>יישוב</th>
                          <th>% ימין</th>
                          <th>הצבעה</th>
                          <th>בז״ב</th>
                        </tr>
                      </thead>
                      <tbody>
                        {clusters.map((c) => (
                          <tr key={c.ashkol}>
                            <td>{c.ashkol}</td>
                            <td>{c.settlement_name}</td>
                            <td>{Number(c.right_pct).toFixed(1)}</td>
                            <td>{Number(c.turnout_pct).toFixed(1)}</td>
                            <td>{c.bzb}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}

        {/* Admin full catalog table */}
        {!loading && role === "super_admin" && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>שם</th>
                  <th>סוג</th>
                  <th>יישוב</th>
                  <th>מחוז</th>
                  <th>אנשי מפתח</th>
                  <th>אשכולות</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const contacts = (i.contacts as Contact[]) ?? [];
                  const clusters = (i.linked_clusters as LinkedCluster[]) ?? [];
                  return (
                    <tr key={i.id}>
                      <td>{i.name}</td>
                      <td>{i.kind || "—"}</td>
                      <td>{i.settlement_name || "—"}</td>
                      <td>{i.district || "—"}</td>
                      <td>
                        {contacts.length > 0
                          ? contacts
                              .map(
                                (c) =>
                                  `${c.full_name}${c.role_title ? ` (${c.role_title})` : ""}${
                                    c.phone ? ` ${c.phone}` : ""
                                  }`,
                              )
                              .join(" · ")
                          : i.key_people_raw || "—"}
                      </td>
                      <td>{clusters.length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="map-credit" style={{ marginTop: "0.75rem" }}>
              {filtered.length} / {institutions.length} מוסדות
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
