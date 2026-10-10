"use client";

import { useEffect, useState } from "react";

type Institution = { id: number; name: string; created_at: string };

export default function InstitutionsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/institutions");
    const data = await res.json();
    setInstitutions(data.institutions ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/institutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      return;
    }
    setName("");
    setMsg("נוסף");
    load();
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>מוסדות</h1>
          </div>
        </header>
        <form className="panel-form" onSubmit={onSubmit}>
          <label>
            שם מוסד
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" className="export">
            הוספה
          </button>
          {msg && <p>{msg}</p>}
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>נוצר</th>
              </tr>
            </thead>
            <tbody>
              {institutions.map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td>{new Date(i.created_at).toLocaleString("he-IL")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
