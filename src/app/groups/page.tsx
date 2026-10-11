"use client";

import { useEffect, useState } from "react";

type Coord = { id: number; full_name: string };
type Settlement = { name_he: string; lat: number; lng: number };
type Group = {
  id: number;
  name: string;
  location_text: string;
  settlement_name: string | null;
  headcount: number;
  gender: string;
  type: string;
  coordinators: Coord[];
};

export default function GroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [coords, setCoords] = useState<Coord[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState({
    name: "",
    location_text: "",
    settlement_name: "",
    headcount: 10,
    gender: "",
    type: "yeshiva",
    coordinator_ids: [] as number[],
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [g, me, u, s] = await Promise.all([
      fetch("/api/groups").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/settlements").then((r) => r.json()),
    ]);
    setGroups(
      (g.groups ?? []).map((x: Group & { coordinators: unknown }) => ({
        ...x,
        coordinators:
          typeof x.coordinators === "string"
            ? JSON.parse(x.coordinators)
            : x.coordinators ?? [],
      })),
    );
    const role = me.user?.role;
    setCanEdit(role === "super_admin" || role === "area_manager");
    setCoords(
      (u.users ?? [])
        .filter((x: { role: string }) => x.role === "coordinator")
        .map((x: { id: number; full_name: string }) => ({
          id: x.id,
          full_name: x.full_name,
        })),
    );
    setSettlements(s.settlements ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      return;
    }
    setMsg("הקבוצה נשמרה");
    setForm({
      name: "",
      location_text: "",
      settlement_name: "",
      headcount: 10,
      gender: "",
      type: "yeshiva",
      coordinator_ids: [],
    });
    load();
  }

  function toggleCoord(id: number) {
    setForm((f) => ({
      ...f,
      coordinator_ids: f.coordinator_ids.includes(id)
        ? f.coordinator_ids.filter((x) => x !== id)
        : [...f.coordinator_ids, id],
    }));
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>קבוצות</h1>
            <p className="lede">ישיבה / גרעין / מכינה — קישור לרכזים וליישוב</p>
          </div>
        </header>

        {canEdit && (
          <form className="panel-form" onSubmit={onSubmit}>
            <div className="form-grid">
              <label>
                שם
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />
              </label>
              <label>
                מיקום בישראל
                <input
                  value={form.location_text}
                  onChange={(e) => setForm({ ...form, location_text: e.target.value })}
                  required
                />
              </label>
              <label>
                יישוב (לשיוך רחובות)
                <select
                  value={form.settlement_name}
                  onChange={(e) =>
                    setForm({ ...form, settlement_name: e.target.value })
                  }
                  required
                >
                  <option value="">בחרו יישוב</option>
                  {settlements.map((s) => (
                    <option key={s.name_he} value={s.name_he}>
                      {s.name_he}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                כמות אנשים
                <input
                  type="number"
                  min={0}
                  value={form.headcount}
                  onChange={(e) =>
                    setForm({ ...form, headcount: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                מגדר
                <input
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                />
              </label>
              <label>
                סוג
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="yeshiva">ישיבה</option>
                  <option value="garin">גרעין</option>
                  <option value="mechina">מכינה</option>
                </select>
              </label>
            </div>
            <fieldset className="coord-set">
              <legend>רכזים מקושרים</legend>
              {coords.map((c) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={form.coordinator_ids.includes(c.id)}
                    onChange={() => toggleCoord(c.id)}
                  />
                  {c.full_name}
                </label>
              ))}
            </fieldset>
            <button type="submit" className="export">
              שמירת קבוצה
            </button>
            {msg && <p>{msg}</p>}
          </form>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>מיקום</th>
                <th>יישוב</th>
                <th>כמות</th>
                <th>מגדר</th>
                <th>סוג</th>
                <th>רכזים</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.id}>
                  <td>{g.name}</td>
                  <td>{g.location_text}</td>
                  <td>{g.settlement_name ?? "—"}</td>
                  <td>{g.headcount}</td>
                  <td>{g.gender}</td>
                  <td>{g.type}</td>
                  <td>
                    {(g.coordinators ?? []).map((c) => c.full_name).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
