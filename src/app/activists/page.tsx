"use client";

import { useEffect, useMemo, useState } from "react";
import { formatMobileDisplay } from "@/lib/activists";

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

export default function ActivistsPage() {
  const [activists, setActivists] = useState<Activist[]>([]);
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [filter, setFilter] = useState<number | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [scope, setScope] = useState<"coordinator" | "manager" | "admin">("coordinator");
  const [hasInstitutions, setHasInstitutions] = useState(true);

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

  const registerOrigin = "https://election-day-ops.vercel.app";
  const link =
    filter === "all"
      ? `${registerOrigin}/register`
      : `${registerOrigin}/register?institution=${filter}`;

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">רישום פעילים</p>
            <h1>פעילים</h1>
            <p className="lede">
              {scope === "admin"
                ? "כל הפעילים שנרשמו. הסינון מציג רק מוסדות שכבר נרשמו אליהם."
                : scope === "manager"
                  ? "פעילים שנרשמו למוסדות של הרכזים שלכם."
                  : "פעילים שנרשמו למוסדות המקושרים אליכם."}
            </p>
          </div>
        </header>
        {loading ? <p className="lede">טוען…</p> : null}
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
              <p className="lede">עדיין אין פעילים רשומים למוסד זה.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>שם</th>
                      <th>נייד</th>
                      <th>מידה</th>
                      <th>מוסד</th>
                      <th>נרשם</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
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
                      </tr>
                    ))}
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
