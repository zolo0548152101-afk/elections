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
  institution_names?: string | null;
  institution_ids?: number[] | string;
  coordinator_ids?: number[] | string;
  coordinator_names?: string | null;
  manager_id?: number | null;
  manager_name?: string;
  settlement_name: string | null;
};

const emptyForm = {
  full_name: "",
  mobile: "",
  email: "",
  password: "",
  role: "coordinator",
  institution_ids: [] as number[],
  coordinator_ids: [] as number[],
  manager_id: "",
};

function parseIds(value: number[] | string | undefined, fallback?: number | null) {
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isInteger(n));
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as number[];
      if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isInteger(n));
    } catch {
      /* ignore */
    }
  }
  return fallback ? [fallback] : [];
}

const roleHe: Record<string, string> = {
  super_admin: "מנהל",
  area_manager: "רכז על",
  coordinator: "רכז",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [meRole, setMeRole] = useState<string>("");
  const [meId, setMeId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [addInstitutionId, setAddInstitutionId] = useState("");
  const [addCoordinatorId, setAddCoordinatorId] = useState("");

  async function load() {
    const [u, me] = await Promise.all([
      fetch("/api/users").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
    ]);
    setUsers(u.users ?? []);
    setMeRole(me.user?.role ?? "");
    setMeId(me.user?.id ?? null);
    if (me.user?.role === "super_admin" || me.user?.role === "area_manager") {
      const i = await fetch("/api/institutions").then((r) => r.json());
      setInstitutions(i.institutions ?? []);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditId(null);
    setShowPassword(false);
    setAddInstitutionId("");
    setAddCoordinatorId("");
  }

  function startEdit(u: UserRow) {
    setEditId(u.id);
    setForm({
      full_name: u.full_name,
      mobile: u.mobile ?? "",
      email: u.email,
      password: "",
      role: u.role,
      institution_ids: parseIds(u.institution_ids, u.institution_id),
      coordinator_ids: parseIds(u.coordinator_ids),
      manager_id: u.manager_id ? String(u.manager_id) : "",
    });
    setAddInstitutionId("");
    setAddCoordinatorId("");
    setShowPassword(false);
    setMsg("עריכה: השאירו סיסמה ריקה כדי לא לשנות. לסיסמה חדשה — לפחות 8 תווים.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addInstitution() {
    const id = Number(addInstitutionId);
    if (!Number.isInteger(id) || form.institution_ids.includes(id)) return;
    setForm({ ...form, institution_ids: [...form.institution_ids, id] });
    setAddInstitutionId("");
  }

  function removeInstitution(id: number) {
    setForm({
      ...form,
      institution_ids: form.institution_ids.filter((x) => x !== id),
    });
  }

  function addCoordinator() {
    const id = Number(addCoordinatorId);
    if (!Number.isInteger(id) || form.coordinator_ids.includes(id)) return;
    setForm({ ...form, coordinator_ids: [...form.coordinator_ids, id] });
    setAddCoordinatorId("");
  }

  function removeCoordinator(id: number) {
    setForm({
      ...form,
      coordinator_ids: form.coordinator_ids.filter((x) => x !== id),
    });
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    const role = meRole === "area_manager" ? "coordinator" : form.role;
    if (!editId && !form.password.trim()) {
      setMsg("סיסמה חובה");
      return;
    }

    setSaving(true);
    const payload = {
      full_name: form.full_name,
      mobile: form.mobile,
      email: form.email,
      role,
      institution_ids: role === "coordinator" ? form.institution_ids : [],
      institution_id:
        role === "coordinator" ? (form.institution_ids[0] ?? null) : null,
      coordinator_ids: role === "area_manager" ? form.coordinator_ids : undefined,
      settlement_name: null,
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
      setMsg(editId ? "עודכן בהצלחה" : "נוצר בהצלחה");
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

  const filteredUsers = users.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    const needle = q.trim();
    if (!needle) return true;
    const hay = [
      u.full_name,
      u.email,
      u.mobile,
      u.institution_name,
      u.institution_names,
      u.coordinator_names,
      u.manager_name,
      roleHe[u.role],
    ]
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
            <h1>משתמשים</h1>
            <p className="lede">
              הוספה ועריכה — סיסמה נשמרת רק כ־hash (לא מוצגת אחרי שמירה)
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
                עורכים את {editingUser?.email}. לחצו עדכון לשמירה.
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
              <label className="field-wide field-password">
                סיסמה
                {editId ? " (ריק = ללא שינוי, מינימום 8)" : " (מינימום 8)"}
                <div className="password-field">
                  <input
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editId}
                    minLength={editId && !form.password ? undefined : 8}
                    autoComplete="new-password"
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
                    <option value="area_manager">רכז על</option>
                    <option value="super_admin">מנהל</option>
                  </select>
                </label>
              )}
              {meRole === "super_admin" && form.role === "coordinator" && (
                <label>
                  רכז על
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
              {(form.role === "coordinator" || meRole === "area_manager") && (
                <div className="field-wide institution-multi">
                  <span className="field-label">מוסדות</span>
                  {form.institution_ids.length === 0 ? (
                    <p className="lede" style={{ margin: "0.35rem 0" }}>
                      אין מוסדות משויכים
                    </p>
                  ) : (
                    <ul className="coord-link-list">
                      {form.institution_ids.map((id) => {
                        const inst = institutions.find((i) => i.id === id);
                        return (
                          <li key={id}>
                            <span>{inst?.name ?? `מוסד #${id}`}</span>
                            <button
                              type="button"
                              className="linkish"
                              onClick={() => removeInstitution(id)}
                            >
                              הסר
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="coord-link-add" style={{ marginTop: "0.5rem" }}>
                    <select
                      value={addInstitutionId}
                      onChange={(e) => setAddInstitutionId(e.target.value)}
                    >
                      <option value="">הוספת מוסד…</option>
                      {institutions
                        .filter((i) => !form.institution_ids.includes(i.id))
                        .map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="export"
                      disabled={!addInstitutionId}
                      onClick={addInstitution}
                    >
                      הוסף
                    </button>
                  </div>
                </div>
              )}
              {meRole === "super_admin" && form.role === "area_manager" && (
                <div className="field-wide institution-multi">
                  <span className="field-label">רכזים תחתיו</span>
                  {form.coordinator_ids.length === 0 ? (
                    <p className="lede" style={{ margin: "0.35rem 0" }}>
                      אין רכזים משויכים
                    </p>
                  ) : (
                    <ul className="coord-link-list">
                      {form.coordinator_ids.map((id) => {
                        const coord = users.find((u) => u.id === id);
                        return (
                          <li key={id}>
                            <span>
                              {coord
                                ? `${coord.full_name} (${coord.email})`
                                : `רכז #${id}`}
                            </span>
                            <button
                              type="button"
                              className="linkish"
                              onClick={() => removeCoordinator(id)}
                            >
                              הסר
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="coord-link-add" style={{ marginTop: "0.5rem" }}>
                    <select
                      value={addCoordinatorId}
                      onChange={(e) => setAddCoordinatorId(e.target.value)}
                    >
                      <option value="">הוספת רכז…</option>
                      {users
                        .filter(
                          (u) =>
                            u.role === "coordinator" &&
                            !form.coordinator_ids.includes(u.id) &&
                            u.id !== editId,
                        )
                        .map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.full_name}
                            {u.manager_id && u.manager_id !== editId
                              ? ` · כבר תחת ${u.manager_name ?? "אחר"}`
                              : ""}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="export"
                      disabled={!addCoordinatorId}
                      onClick={addCoordinator}
                    >
                      הוסף
                    </button>
                  </div>
                </div>
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

        <div className="panel-form users-filters">
          <label>
            חיפוש
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="שם, אימייל, מוסד…"
            />
          </label>
          <label>
            תפקיד
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">הכל</option>
              <option value="coordinator">רכז</option>
              <option value="area_manager">רכז על</option>
              <option value="super_admin">מנהל</option>
            </select>
          </label>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>שם</th>
                <th>אימייל</th>
                <th>נייד</th>
                <th>תפקיד</th>
                <th>מוסד / רכזים</th>
                {canManage && <th>פעולות</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className={editId === u.id ? "row-editing" : undefined}>
                  <td>{u.full_name}</td>
                  <td dir="ltr">{u.email}</td>
                  <td dir="ltr">{u.mobile}</td>
                  <td>{roleHe[u.role] ?? u.role}</td>
                  <td>
                    {u.role === "area_manager"
                      ? u.coordinator_names || "—"
                      : u.institution_names || u.institution_name || "—"}
                  </td>
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
          <p className="map-credit" style={{ marginTop: "0.75rem" }}>
            מציג {filteredUsers.length} / {users.length}
          </p>
        </div>
      </div>
    </main>
  );
}
