"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FormMsg } from "@/components/FormMsg";
import { ShowMore } from "@/components/ShowMore";
import { useTimedFlash } from "@/hooks/useTimedFlash";
import { formatAshkolLabel, formatAshkolLabels } from "@/lib/ashkol-label";
import { matchesSearch, normalizeSearch } from "@/lib/text-search";

type LinkedCluster = { ashkol: string; settlement_name?: string };
type Institution = {
  id: number;
  name: string;
  kind?: string | null;
  settlement_name?: string | null;
  linked_clusters?: LinkedCluster[] | string;
};
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

type UserForm = {
  full_name: string;
  mobile: string;
  email: string;
  password: string;
  role: string;
  institution_ids: number[];
  coordinator_ids: number[];
  manager_id: string;
};

function freshForm(): UserForm {
  return {
    full_name: "",
    mobile: "",
    email: "",
    password: "",
    role: "coordinator",
    institution_ids: [],
    coordinator_ids: [],
    manager_id: "",
  };
}

function parseIds(value: number[] | string | undefined, fallback?: number | null) {
  if (Array.isArray(value)) {
    return value.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      }
    } catch {
      /* ignore */
    }
  }
  return fallback != null && Number.isInteger(Number(fallback)) && Number(fallback) > 0
    ? [Number(fallback)]
    : [];
}

function parseClusters(value: LinkedCluster[] | string | undefined): LinkedCluster[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value) as LinkedCluster[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function institutionClusters(inst: Institution | undefined): LinkedCluster[] {
  if (!inst) return [];
  return parseClusters(inst.linked_clusters).filter((c) =>
    String(c.ashkol ?? "").trim(),
  );
}

/** e.g. אב"ע אורות מודיעין · 3000381 · מודיעין, 3000376 · כפר סבא */
function institutionLabel(inst: Institution | undefined, fallbackId?: number): string {
  if (!inst) return fallbackId ? `מוסד #${fallbackId}` : "—";
  const labels = formatAshkolLabels(institutionClusters(inst));
  if (!labels) return inst.name;
  return `${inst.name} · ${labels}`;
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
  const [form, setForm] = useState<UserForm>(freshForm);
  const [editId, setEditId] = useState<number | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const { msg, kind: msgKind, flash, clear: clearMsg } = useTimedFlash(4000);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);
  const [sentOkId, setSentOkId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
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
    setForm(freshForm());
    setEditId(null);
    setShowPassword(false);
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
    setAddCoordinatorId("");
    setShowPassword(false);
    flash("info", "עריכה: השאירו סיסמה ריקה כדי לא לשנות. לסיסמה חדשה — לפחות 8 תווים.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addInstitution(id: number) {
    if (!Number.isInteger(id) || id <= 0) return;
    setForm((prev) =>
      prev.institution_ids.includes(id)
        ? prev
        : { ...prev, institution_ids: [...prev.institution_ids, id] },
    );
  }

  function removeInstitution(id: number) {
    setForm((prev) => ({
      ...prev,
      institution_ids: prev.institution_ids.filter((x) => x !== id),
    }));
  }

  function addCoordinator() {
    const id = Number(addCoordinatorId);
    if (!Number.isInteger(id) || id <= 0) return;
    setForm((prev) =>
      prev.coordinator_ids.includes(id)
        ? prev
        : { ...prev, coordinator_ids: [...prev.coordinator_ids, id] },
    );
    setAddCoordinatorId("");
  }

  function removeCoordinator(id: number) {
    setForm((prev) => ({
      ...prev,
      coordinator_ids: prev.coordinator_ids.filter((x) => x !== id),
    }));
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    clearMsg();

    const role = meRole === "area_manager" ? "coordinator" : form.role;
    if (!form.full_name.trim() || !form.mobile.trim()) {
      flash("err", "שם ונייד חובה");
      return;
    }
    if (!editId && !form.password.trim()) {
      flash("err", "סיסמה חובה");
      return;
    }

    const institutionIds = role === "coordinator" ? form.institution_ids : [];

    setSaving(true);
    const payload = {
      full_name: form.full_name,
      mobile: form.mobile,
      email: form.email,
      role,
      institution_ids: institutionIds,
      institution_id: institutionIds[0] ?? null,
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
        flash("err", data.error || "שגיאה");
        return;
      }
      const savedNames = institutionIds
        .map((id) => institutions.find((i) => i.id === id)?.name)
        .filter(Boolean)
        .join(" · ");
      flash(
        "ok",
        editId
          ? role === "coordinator"
            ? `עודכן בהצלחה${savedNames ? ` · מוסדות: ${savedNames}` : " · ללא מוסדות"}`
            : "עודכן בהצלחה"
          : "נוצר בהצלחה",
      );
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(u: UserRow) {
    if (u.id === meId) {
      flash("err", "לא ניתן למחוק את המשתמש המחובר");
      return;
    }
    const ok = window.confirm(
      `למחוק את ${u.full_name} (${u.mobile || u.email})? הפעולה אינה ניתנת לביטול.`,
    );
    if (!ok) return;
    clearMsg();
    const res = await fetch(`/api/users/${u.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      flash("err", data.error || "שגיאה במחיקה");
      return;
    }
    if (editId === u.id) resetForm();
    flash("ok", "נמחק בהצלחה");
    await load();
  }

  async function sendCredentials(u: UserRow) {
    if (!u.mobile?.trim()) {
      flash("err", "למשתמש אין מספר נייד");
      return;
    }
    const ok = window.confirm(
      `לשלוח ל-${u.full_name} (${u.mobile}) את פרטי ההתחברות הקבועים ב-WhatsApp?`,
    );
    if (!ok) return;
    setSendingId(u.id);
    setSentOkId(null);
    clearMsg();
    try {
      const res = await fetch(`/api/users/${u.id}/send-credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        flash("err", data.error || "שגיאה בשליחה");
        return;
      }
      setSentOkId(u.id);
      flash(
        "ok",
        `✓ ההודעה נשלחה בהצלחה ב-WhatsApp אל ${u.full_name} (${u.mobile})`,
      );
      window.scrollTo({ top: 0, behavior: "smooth" });
      window.setTimeout(() => {
        setSentOkId((cur) => (cur === u.id ? null : cur));
      }, 4000);
    } catch (err) {
      flash(
        "err",
        err instanceof Error
          ? `שגיאת רשת בשליחה: ${err.message}`
          : "שגיאת רשת בשליחה",
      );
    } finally {
      setSendingId(null);
    }
  }

  const canManage = meRole === "super_admin" || meRole === "area_manager";
  const editingUser = editId ? users.find((u) => u.id === editId) : null;

  const institutionById = useMemo(() => {
    const map = new Map<number, Institution>();
    for (const inst of institutions) map.set(inst.id, inst);
    return map;
  }, [institutions]);

  function userInstitutionLabel(u: UserRow): string {
    if (u.role === "area_manager") return u.coordinator_names || "—";
    const ids = parseIds(u.institution_ids, u.institution_id);
    if (ids.length === 0) return u.institution_names || u.institution_name || "—";
    return ids
      .map((id) => institutionLabel(institutionById.get(id), id))
      .join(" · ");
  }

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
      userInstitutionLabel(u),
      roleHe[u.role],
    ]
      .filter(Boolean)
      .join(" ");
    return matchesSearch(hay, needle);
  });

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>משתמשים</h1>
            <p className="lede">
              הוספה ועריכה — סיסמה נשמרת גם לשליחה חוזרת ב-WhatsApp (לא מוצגת אחרי שמירה)
            </p>
          </div>
        </header>

        {canManage && (
          <form className="panel-form" onSubmit={saveUser}>
            <h2>
              {editId ? (
                <>
                  עריכת משתמש: <ShowMore text={editingUser?.full_name ?? ""} />
                </>
              ) : (
                `הוספת ${meRole === "area_manager" ? "רכז" : "משתמש"}`
              )}
            </h2>
            {editId && (
              <p className="edit-banner">
                עורכים את {editingUser?.mobile || editingUser?.email}. לחצו עדכון לשמירה.
              </p>
            )}
            <div className="form-grid form-grid-dense">
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
                נייד (התחברות)
                <input
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  value={form.mobile}
                  onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                  required
                  placeholder="05…"
                />
              </label>
              <label>
                אימייל (אופציונלי)
                <input
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
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
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "הסתר סיסמה" : "הצג סיסמה"}
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
                      אין מוסדות משויכים — חפשו מוסד או אשכול ובחרו כדי להוסיף
                    </p>
                  ) : (
                    <ul className="coord-link-list">
                      {form.institution_ids.map((id) => {
                        const inst = institutionById.get(id);
                        return (
                          <li key={id}>
                            <ShowMore text={institutionLabel(inst, id)} />
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
                  <InstitutionAddSearch
                    institutions={institutions}
                    excludeIds={form.institution_ids}
                    onAdd={addInstitution}
                  />
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
                            <ShowMore
                              text={
                                coord
                                  ? `${coord.full_name} (${coord.email})`
                                  : `רכז #${id}`
                              }
                            />
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
          </form>
        )}

        {msg && (
          <div style={{ marginBottom: "0.75rem" }}>
            <FormMsg kind={msgKind} sticky>
              {msg}
            </FormMsg>
          </div>
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
                <th>נייד</th>
                <th>תפקיד</th>
                {canManage && <th>פעולות</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className={editId === u.id ? "row-editing" : undefined}>
                  <td>
                    <ShowMore text={u.full_name} />
                  </td>
                  <td dir="ltr">{u.mobile}</td>
                  <td>{roleHe[u.role] ?? u.role}</td>
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
                        className="export"
                        disabled={!u.mobile?.trim() || sendingId === u.id}
                        onClick={() => void sendCredentials(u)}
                        title={
                          u.mobile?.trim()
                            ? "שליחת פרטי התחברות ב-WhatsApp"
                            : "אין נייד"
                        }
                      >
                        {sendingId === u.id
                          ? "שולח…"
                          : sentOkId === u.id
                            ? "נשלח ✓"
                            : "שלח בוואטסאפ"}
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

function institutionHay(inst: Institution): string {
  const clusters = institutionClusters(inst);
  return [
    inst.name,
    inst.kind,
    inst.settlement_name,
    ...clusters.map((c) => formatAshkolLabel(c.ashkol, c.settlement_name)),
    ...clusters.map((c) => c.settlement_name),
  ]
    .filter(Boolean)
    .join(" ");
}

function searchLabel(inst: Institution): string {
  const clusters = formatAshkolLabels(institutionClusters(inst));
  return [inst.name, inst.kind, clusters].filter(Boolean).join(" · ");
}

function searchRank(inst: Institution, term: string): number {
  const needle = normalizeSearch(term);
  const name = normalizeSearch(inst.name);
  if (name.startsWith(needle)) return 0;
  if (name.includes(needle)) return 1;
  const clusters = institutionClusters(inst);
  const place = normalizeSearch(
    [
      inst.settlement_name,
      ...clusters.map((c) => formatAshkolLabel(c.ashkol, c.settlement_name)),
    ]
      .filter(Boolean)
      .join(" "),
  );
  if (place.includes(needle)) return 2;
  return 3;
}

/** One field: type a institution or cluster, then choose it to attach. */
function InstitutionAddSearch({
  institutions,
  excludeIds,
  onAdd,
}: {
  institutions: Institution[];
  excludeIds: number[];
  onAdd: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const hits = useMemo(() => {
    const term = q.trim();
    if (!term) return [];
    return institutions
      .filter((i) => !excludeIds.includes(i.id))
      .filter((i) => matchesSearch(institutionHay(i), term))
      .sort((a, b) => searchRank(a, term) - searchRank(b, term) || a.name.localeCompare(b.name, "he"))
      .slice(0, 12);
  }, [institutions, excludeIds, q]);

  useEffect(() => {
    setActive(0);
  }, [q]);

  useEffect(() => {
    function onDoc(e: PointerEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  function choose(inst: Institution) {
    onAdd(inst.id);
    setQ("");
    setOpen(false);
  }

  const showList = open && q.trim().length > 0;

  return (
    <div className="coord-link-add institution-add-search">
      <div className="ashkol-search" ref={boxRef}>
        <input
          type="search"
          value={q}
          placeholder="חיפוש והוספת מוסד או אשכול…"
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Escape") {
              setOpen(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList && hits[active]) choose(hits[active]);
            }
          }}
        />
        {showList && (
          <ul className="search-hits" id={listId} role="listbox">
            {hits.length === 0 ? (
              <li className="search-hint">אין תוצאות</li>
            ) : (
              hits.map((h, i) => (
                <li key={h.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    className={i === active ? "active" : undefined}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      choose(h);
                    }}
                  >
                    {searchLabel(h)}
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
