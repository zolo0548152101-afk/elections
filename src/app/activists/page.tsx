"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMobileDisplay, SHIRT_SIZES } from "@/lib/activists";
import { ConfirmDelete } from "@/components/ConfirmDelete";
import { SortTh, sortRows, useSortState, type SortGetters } from "@/components/SortTh";
import { Quip } from "@/components/Quip";
import { LOADING } from "@/lib/quips";
import { EMPTY_ACTIVISTS } from "@/lib/quips";
import { PageQuip } from "@/components/PageQuip";

type Activist = {
  id: number;
  full_name: string;
  mobile: string;
  shirt_size: string;
  created_at: string;
  updated_at: string;
  institution_id: number;
  institution_name: string;
  settlement_name: string | null;
};

type Institution = { id: number; name: string; settlement_name: string | null };

function when(value: string) {
  return new Date(value).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "short",
    timeStyle: "short",
  });
}

const APP_ACTIVISTS_SORT: SortGetters<Activist, "name" | "mobile" | "size" | "inst" | "created"> = {
  name: (r) => r.full_name,
  mobile: (r) => r.mobile,
  size: (r) => ["XS","S","M","L","XL","XXL","3XL"].indexOf(r.shirt_size),
  inst: (r) => r.institution_name,
  created: (r) => new Date(r.created_at),
};

export default function ActivistsPage() {
  const tsort = useSortState<"name" | "mobile" | "size" | "inst" | "created">();
  const [activists, setActivists] = useState<Activist[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [filter, setFilter] = useState<number | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [scope, setScope] = useState<"coordinator" | "manager" | "admin">("coordinator");
  const [hasInstitutions, setHasInstitutions] = useState(true);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ full_name: "", mobile: "", shirt_size: "M" });
  const [rowError, setRowError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function startEdit(row: Activist) {
    setEditId(row.id);
    setDraft({ full_name: row.full_name, mobile: row.mobile, shirt_size: row.shirt_size });
    setRowError(null);
  }

  async function saveEdit(id: number) {
    setSaving(true);
    setRowError(null);
    try {
      const res = await fetch(`/api/activists/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setActivists((list) => list.map((a) => (a.id === id ? { ...a, ...data.activist } : a)));
      setEditId(null);
    } catch (err) {
      setRowError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    const res = await fetch(`/api/activists/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "המחיקה נכשלה");
      return;
    }
    setActivists((list) => list.filter((a) => a.id !== id));
  }

  useEffect(() => {
    fetch("/api/activists")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "שגיאה");
        setActivists(data.activists ?? []);
        setInstitutions(data.institutions ?? []);
        setScope(data.scope ?? "coordinator");
        setHasInstitutions(data.hasInstitutions !== false);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "שגיאה"))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(
    () => (filter === "all" ? activists : activists.filter((row) => row.institution_id === filter)),
    [activists, filter],
  );
  const tally = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.shirt_size, (counts.get(row.shirt_size) ?? 0) + 1);
    return [...counts.entries()].map(([size, n]) => `${size} ${n}`).join(" · ");
  }, [rows]);

  const registerOrigin = "https://yaminwin26.app";
  const link =
    filter === "all"
      ? `${registerOrigin}/register`
      : `${registerOrigin}/register?institution=${filter}`;

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <h1>הרשמת פעילים</h1>
            <PageQuip />
          </div>
        </header>
        {loading ? <p className="lede"><Quip list={LOADING} /></p> : null}
        {error ? <p className="form-msg form-msg-err">{error}</p> : null}
        {!loading && !error && !hasInstitutions ? (
          <p className="lede">לא שויך מוסד למשתמש זה — פנו למנהל.</p>
        ) : null}
        {!loading && !error && hasInstitutions ? (
          <>
            <div className="activists-bar">
              {(scope === "admin" && institutions.length > 0) || institutions.length > 1 ? (
                <label>
                  מוסד
                  <select
                    value={filter === "all" ? "all" : String(filter)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setFilter(value === "all" ? "all" : Number(value));
                    }}
                  >
                    <option value="all">כל המוסדות</option>
                    {institutions.map((institution) => (
                      <option key={institution.id} value={institution.id}>
                        {institution.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p>{tally || "עדיין אין מידות"}</p>
              <button
                type="button"
                className="export"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? "הקישור הועתק" : "העתקת קישור הרשמה"}
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="lede"><Quip list={EMPTY_ACTIVISTS} /></p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <SortTh k="name" sort={tsort.sort} onSort={tsort.toggle}>שם</SortTh>
                      <SortTh k="mobile" sort={tsort.sort} onSort={tsort.toggle}>נייד</SortTh>
                      <SortTh k="size" sort={tsort.sort} onSort={tsort.toggle}>מידה</SortTh>
                      <SortTh k="inst" sort={tsort.sort} onSort={tsort.toggle}>מוסד</SortTh>
                      <SortTh k="created" sort={tsort.sort} onSort={tsort.toggle}>נרשם</SortTh>
                      <th>פעולות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortRows(rows, APP_ACTIVISTS_SORT, tsort.sort).map((row) =>
                      editId === row.id ? (
                        <tr key={row.id} className="is-editing">
                          <td>
                            <input
                              className="row-edit-input"
                              aria-label="שם"
                              value={draft.full_name}
                              onChange={(e) => setDraft({ ...draft, full_name: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              className="row-edit-input"
                              aria-label="נייד"
                              dir="ltr"
                              inputMode="tel"
                              value={draft.mobile}
                              onChange={(e) => setDraft({ ...draft, mobile: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              className="row-edit-input"
                              aria-label="מידה"
                              value={draft.shirt_size}
                              onChange={(e) => setDraft({ ...draft, shirt_size: e.target.value })}
                            >
                              {SHIRT_SIZES.map((size) => (
                                <option key={size} value={size}>
                                  {size}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            {row.institution_name}
                            {row.settlement_name ? ` · ${row.settlement_name}` : ""}
                          </td>
                          <td>{when(row.created_at)}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="row-btn row-btn-primary"
                                disabled={saving}
                                onClick={() => void saveEdit(row.id)}
                              >
                                {saving ? "שומר…" : "שמירה"}
                              </button>
                              <button type="button" className="row-btn" onClick={() => setEditId(null)}>
                                ביטול
                              </button>
                            </div>
                            {rowError ? <p className="row-error">{rowError}</p> : null}
                          </td>
                        </tr>
                      ) : (
                        <tr key={row.id}>
                          <td>{row.full_name}</td>
                          <td>
                            <a href={`tel:${row.mobile}`}>{formatMobileDisplay(row.mobile)}</a>
                          </td>
                          <td>{row.shirt_size}</td>
                          <td>
                            {row.institution_name}
                            {row.settlement_name ? ` · ${row.settlement_name}` : ""}
                          </td>
                          <td>
                            {when(row.created_at)}
                            {new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1000
                              ? " · עודכן"
                              : ""}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button type="button" className="row-btn" onClick={() => startEdit(row)}>
                                עריכה
                              </button>
                              <ConfirmDelete onConfirm={() => remove(row.id)} />
                            </div>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  );
}
