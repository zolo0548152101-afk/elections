"use client";

import { useEffect, useMemo, useState } from "react";
import { COORDINATOR_SIGNUP_KINDS } from "@/lib/coordinator-signups";

type Signup = {
  id: number;
  first_name: string;
  last_name: string;
  institution_name: string;
  institution_kind: string;
  created_at: string;
  updated_at: string;
};

function when(value: string) {
  return new Date(value).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default function CoordinatorSignupsPage() {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [kind, setKind] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/coordinator-signups")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(res.status === 403 ? "הדף זמין למנהל בלבד" : data.error || "שגיאה");
        setSignups(data.signups ?? []);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "שגיאה"))
      .finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    const q = query.trim();
    return signups.filter(
      (row) =>
        (kind === "all" || row.institution_kind === kind) &&
        (!q ||
          `${row.first_name} ${row.last_name} ${row.institution_name}`.includes(q)),
    );
  }, [signups, kind, query]);

  const tally = useMemo(
    () =>
      COORDINATOR_SIGNUP_KINDS.map(
        (k) => `${k} ${signups.filter((row) => row.institution_kind === k).length}`,
      ).join(" · "),
    [signups],
  );

  const link = "https://yaminwin26.app/register/coordinators";

  function exportCsv() {
    const lines = [
      ["שם פרטי", "שם משפחה", "שם המוסד", "סוג מוסד", "נרשם"].join(","),
      ...rows.map((row) =>
        [row.first_name, row.last_name, row.institution_name, row.institution_kind, when(row.created_at)]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "רכזים-שנרשמו.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">רישום רכזים</p>
            <h1>רכזים שנרשמו</h1>
            <p className="lede">
              כל מי שמילא את טופס רישום הרכזים. שם המוסד נכתב חופשי, כפי שהנרשם הקליד.
            </p>
          </div>
        </header>
        {loading ? <p className="lede">טוען…</p> : null}
        {error ? <p className="form-msg form-msg-err">{error}</p> : null}
        {!loading && !error ? (
          <>
            <div className="activists-bar">
              <label>
                סוג מוסד
                <select value={kind} onChange={(event) => setKind(event.target.value)}>
                  <option value="all">כל הסוגים</option>
                  {COORDINATOR_SIGNUP_KINDS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                חיפוש
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="שם או מוסד"
                />
              </label>
              <p>
                {signups.length} נרשמו · {tally}
              </p>
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
              <button type="button" className="export" disabled={rows.length === 0} onClick={exportCsv}>
                ייצוא CSV
              </button>
            </div>
            {rows.length === 0 ? (
              <p className="lede">
                {signups.length === 0 ? "עדיין אין רכזים רשומים." : "אין תוצאות לסינון הזה."}
              </p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>שם פרטי</th>
                      <th>שם משפחה</th>
                      <th>שם המוסד</th>
                      <th>סוג מוסד</th>
                      <th>נרשם</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.first_name}</td>
                        <td>{row.last_name}</td>
                        <td>{row.institution_name}</td>
                        <td>{row.institution_kind}</td>
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
