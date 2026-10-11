"use client";

import { useEffect, useState } from "react";

type Contact = {
  id: number;
  full_name: string;
  role_title: string;
  phone: string;
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
};

export default function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [kinds, setKinds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState("");

  async function load() {
    const res = await fetch("/api/institutions");
    const data = await res.json();
    if (res.status === 403) {
      setForbidden(true);
      setInstitutions([]);
      return;
    }
    setForbidden(false);
    setKinds(data.kinds ?? []);
    setInstitutions(
      (data.institutions ?? []).map((i: Institution) => ({
        ...i,
        contacts:
          typeof i.contacts === "string" ? JSON.parse(i.contacts) : i.contacts ?? [],
      })),
    );
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
            <h1>מוסדות</h1>
            <p className="lede">
              קטלוג מחוברת2 — סוג, יישוב, מחוז, קואורדינטות ואנשי מפתח
            </p>
          </div>
        </header>
        {forbidden ? (
          <p className="lede" style={{ color: "var(--sand)" }}>
            אין הרשאה לניהול מוסדות.
          </p>
        ) : (
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
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>סוג</th>
                <th>יישוב</th>
                <th>מחוז</th>
                <th>אנשי מפתח</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => {
                const contacts = (i.contacts as Contact[]) ?? [];
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
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="map-credit" style={{ marginTop: "0.75rem" }}>
            {filtered.length} / {institutions.length} מוסדות
          </p>
        </div>
      </div>
    </main>
  );
}
