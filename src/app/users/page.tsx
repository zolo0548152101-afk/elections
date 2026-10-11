"use client";

import { useEffect, useState } from "react";
import { SettlementPicker } from "@/components/SettlementPicker";

type Institution = { id: number; name: string };
type UserRow = {
  id: number;
  full_name: string;
  mobile: string | null;
  email: string;
  role: string;
  institution_id: number | null;
  institution_name?: string;
  manager_id?: number | null;
  manager_name?: string;
  settlement_name: string | null;
  login_password?: string | null;
};

const emptyForm = {
  full_name: "",
  mobile: "",
  email: "",
  password: "",
  role: "coordinator",
  institution_id: "",
  settlement_name: "",
  manager_id: "",
};

const roleHe: Record<string, string> = {
  super_admin: "מנהל על",
  area_manager: "מנהל אזור",
  coordinator: "רכז",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [settlements, setSettlements] = useState<string[]>([]);
  const [meRole, setMeRole] = useState<string>("");
  const [meId, setMeId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [editNeedsPassword, setEditNeedsPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [revealIds, setRevealIds] = useState<Record<number, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    const [u, me] = await Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ]);
    setUsers(u.users ?? []);
    setMeRole(me.user?.role ?? "");
    setMeId(me.user?.id ?? null);
    if (me.user?.role === "super_admin" || me.user?.role === "area_manager") {
      const [i, s] = await Promise.all([
        fetch("/api/institutions").then((r) => r.json()),
        fetch("/api/settlements").then((r) => r.json()),
      ]);
      setInstitutions(i.institutions ?? []);
      setSettlements(
        (s.settlements ?? []).map((row: { name_he: string }) => row.name_he),
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditId(null);
    setEditNeedsPassword(false);
    setShowPassword(false);
  }

  function startEdit(u: UserRow) {
    const needsPassword = !u.login_password;
    setEditId(u.id);
    setEditNeedsPassword(needsPassword);
    setForm({
      full_name: u.full_name,
      mobile: u.mobile ?? "",
      email: u.email,
      password: u.login_password ?? "",
      role: u.role,
      institution_id: u.institution_id ? String(u.institution_id) : "",
      settlement_name: u.settlement_name ?? "",
      manager_id: u.manager_id ? String(u.manager_id) : "",
    });
    setShowPassword(needsPassword || Boolean(u.login_password));
    setMsg(
      needsPassword
        ? "למשתמש זה אין סיסמה שמורה — הזינו סיסמה חדשה ולחצו עדכון. אפשר גם לבחור יישוב ומוסד."
        : null,
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const role = meRole === "area_manager" ? "coordinator" : form.role;
    if (role === "coordinator" && !form.settlement_name.trim()) {
      setMsg("לרכז חובה לבחור יישוב מהרשימה");
      return;
    }
    if (!editId && !form.password.trim()) {
      setMsg("סיסמה חובה");
      return;
    }
    if (editId && editNeedsPassword && !form.password.trim()) {
      setMsg("יש להגדיר סיסמה למשתמש זה");
      return;
    }

    setSaving(true);
    const payload = {
      full_name: form.full_name,
      mobile: form.mobile,
      email: form.email,
      role,
      institution_id: form.institution_id ? Number(form.institution_id) : null,
      settlement_name: form.settlement_name.trim() || null,
      manager_id:
        role === "coordinator" && form.manager_id
          ? Number(form.manager_id)
          : null,
      password: form.password.trim() || undefined,
    };

    try {
      const res = await fetch(editId ? `/api/users/${editId}` : "/api/users", {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error || "שגיאה");
        return;
      }
      setMsg(editId ? "עודכן בהצלחה — יישוב, מוסד וסיסמה נשמרו" : "נוצר בהצלחה");
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(u: UserRow) {
    if (u.id === meId) {
      setMsg("לא ניתן למחוק את המשתמש המחובר");
      return;
    }
    const ok = window.confirm(
      `למחוק את ${u.full_name} (${u.email})? הפעולה אינה ניתנת לביטול.`,
    );
    if (!ok) return;
    setMsg(null);
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "שגיאה במחיקה");
      return;
    }
    if (editId === u.id) resetForm();
    setMsg("נמחק בהצלחה");
    await load();
  }

  const canManage = meRole === "super_admin" || meRole === "area_manager";
  const editingUser = editId ? users.find((u) => u.id === editId) : null;
  const showSettlement =
    form.role === "coordinator" || meRole === "area_manager";

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>משתמשים</h1>
            <p className="lede">
              הוספה ועריכה למעלה בטופס — בחרו יישוב בהקלדה, הגדירו סיסמה, ואז עדכון
            </p>
          </div>
        </header>

        {canManage && (
          <form className="panel-form" onSubmit={saveUser}>
            <h2>
              {editId
                ? `עריכת משתמש: ${editingUser?.full_name ?? ""}`
                : `הוספת ${meRole === "area_manager" ? "רכז" : "משתמש"}`}
            </h2>
            {editId && (
              <p className="edit-banner">
                עורכים את {editingUser?.email}. בחרו יישוב מההשלמה האוטומטית ולחצו
                עדכון.
              </p>
            )}
            <div className="form-grid">
              <label>
                שם מלא
                <input
                  dir="auto"
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
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </label>
              <label>
                סיסמה
                {editId && !editNeedsPassword ? " (השאירו ריק כדי לא לשנות)" : ""}
                {editNeedsPassword ? " — חובה להגדיר" : ""}
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editId || editNeedsPassword}
                    autoComplete="new-password"
                    placeholder={editNeedsPassword ? "הזינו סיסמה חדשה" : ""}
                  />
                  <button
                    type="button"
                    className="reset"
                    onClick={() => setShowPassword((v) => !v)}
                  >
                    {showPassword ? "הסתר" : "הצג"}
                  </button>
                </div>
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
              {meRole === "super_admin" && form.role === "coordinator" && (
                <label>
                  מנהל אזור
                  <select
                    value={form.manager_id}
                    onChange={(e) => setForm({ ...form, manager_id: e.target.value })}
                  >
                    <option value="">—</option>
                    {users
                      .filter((u) => u.role === "area_manager")
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.full_name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label>
                מוסד
                <select
                  value={form.institution_id}
                  onChange={(e) =>
                    setForm({ ...form, institution_id: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
              {showSettlement && (
                <label>
                  יישוב (לרכז){form.role === "coordinator" ? " *" : ""}
                  <SettlementPicker
                    value={form.settlement_name}
                    options={settlements}
                    required={form.role === "coordinator"}
                    onChange={(settlement_name) =>
                      setForm({ ...form, settlement_name })
                    }
                  />
                </label>
              )}
            </div>
            <div className="form-actions">
              <button type="submit" className="export" disabled={saving}>
                {saving ? "שומר…" : editId ? "עדכון" : "שמירה"}
              </button>
              {editId && (
                <button type="button" className="reset" onClick={resetForm}>
                  ביטול עריכה
                </button>
              )}
            </div>
            {msg && <p className="form-msg">{msg}</p>}
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
                {canManage && <th>סיסמה</th>}
                {canManage && <th>פעולות</th>}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={editId === u.id ? "row-editing" : undefined}>
                  <td>{u.full_name}</td>
                  <td dir="ltr">{u.email}</td>
                  <td dir="ltr">{u.mobile}</td>
                  <td>{roleHe[u.role] ?? u.role}</td>
                  <td>{u.institution_name || "—"}</td>
                  <td>{u.settlement_name || "—"}</td>
                  {canManage && (
                    <td className="password-cell">
                      {u.login_password ? (
                        <>
                          <bdi dir="ltr">
                            {revealIds[u.id] ? u.login_password : "••••••••"}
                          </bdi>
                          <button
                            type="button"
                            className="linkish"
                            onClick={() =>
                              setRevealIds((m) => ({ ...m, [u.id]: !m[u.id] }))
                            }
                          >
                            {revealIds[u.id] ? "הסתר" : "הצג"}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="linkish"
                          onClick={() => startEdit(u)}
                        >
                          לא נשמרה — לחצו להגדרה
                        </button>
                      )}
                    </td>
                  )}
                  {canManage && (
                    <td className="actions-cell">
                      <button
                        type="button"
                        className="export"
                        onClick={() => startEdit(u)}
                      >
                        עריכה
                      </button>
                      <button
                        type="button"
                        className="reset"
                        disabled={u.id === meId}
                        onClick={() => void deleteUser(u)}
                      >
                        מחיקה
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
