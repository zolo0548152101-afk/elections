"use client";

import { useEffect, useState } from "react";

type Institution = { id: number; name: string };
type UserRow = {
  id: number;
  full_name: string;
  mobile: string | null;
  email: string;
  role: string;
  institution_id: number | null;
  institution_name?: string;
  manager_name?: string;
  settlement_name: string | null;
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [meRole, setMeRole] = useState<string>("");
  const [form, setForm] = useState({
    full_name: "",
    mobile: "",
    email: "",
    password: "",
    role: "coordinator",
    institution_id: "",
    settlement_name: "",
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const [u, me] = await Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ]);
    setUsers(u.users ?? []);
    setMeRole(me.user?.role ?? "");
    if (me.user?.role === "super_admin" || me.user?.role === "area_manager") {
      const i = await fetch("/api/institutions").then((r) => r.json());
      setInstitutions(i.institutions ?? []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        institution_id: form.institution_id ? Number(form.institution_id) : null,
        settlement_name: form.settlement_name || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה");
      return;
    }
    setMsg("נוצר בהצלחה");
    setForm({
      full_name: "",
      mobile: "",
      email: "",
      password: "",
      role: "coordinator",
      institution_id: "",
      settlement_name: "",
    });
    load();
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>משתמשים</h1>
          </div>
        </header>

        {(meRole === "super_admin" || meRole === "area_manager") && (
          <form className="panel-form" onSubmit={createUser}>
            <h2>הוספת {meRole === "area_manager" ? "רכז" : "משתמש"}</h2>
            <div className="form-grid">
              <label>
                שם מלא
                <input
                  value={form.full_name}
                  onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                  required
                />
              </label>
              <label>
                נייד
                <input
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                />
              </label>
              <label>
                אימייל
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </label>
              <label>
                סיסמה
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                />
              </label>
              {meRole === "super_admin" && (
                <label>
                  תפקיד
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  >
                    <option value="coordinator">רכז</option>
                    <option value="area_manager">מנהל אזור</option>
                    <option value="super_admin">מנהל על</option>
                  </select>
                </label>
              )}
              <label>
                מוסד
                <select
                  value={form.institution_id}
                  onChange={(e) => setForm({ ...form, institution_id: e.target.value })}
                >
                  <option value="">—</option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                יישוב (לרכז)
                <input
                  value={form.settlement_name}
                  onChange={(e) => setForm({ ...form, settlement_name: e.target.value })}
                  placeholder="שם יישוב בעברית"
                />
              </label>
            </div>
            <button type="submit" className="export">
              שמירה
            </button>
            {msg && <p className="lede">{msg}</p>}
          </form>
        )}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>אימייל</th>
                <th>נייד</th>
                <th>תפקיד</th>
                <th>מוסד</th>
                <th>יישוב</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.full_name}</td>
                  <td>{u.email}</td>
                  <td>{u.mobile}</td>
                  <td>{u.role}</td>
                  <td>{u.institution_name}</td>
                  <td>{u.settlement_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
