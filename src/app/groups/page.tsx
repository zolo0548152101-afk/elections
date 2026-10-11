"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Contact = {
  id: number;
  full_name: string;
  role_title: string;
  phone: string;
};

type LinkedCluster = {
  ashkol: string;
  settlement_name: string;
  right_pct: number;
  turnout_pct: number;
  bzb: number;
};

type Institution = {
  id: number;
  name: string;
  kind: string | null;
  settlement_name: string | null;
  district: string | null;
  contacts?: Contact[] | string;
  linked_clusters?: LinkedCluster[] | string;
};

/**
 * Product: "קבוצות" = the coordinator's institution (חוברת2 מוסד).
 * Admins manage the full catalog on /institutions; this page shows the
 * institution(s) relevant to the signed-in role plus linked clusters.
 */
export default function GroupsPage() {
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [instRes, meRes] = await Promise.all([
        fetch("/api/institutions"),
        fetch("/api/auth/me"),
      ]);
      const instData = await instRes.json();
      const meData = await meRes.json();
      setRole(meData.user?.role ?? null);
      if (!instRes.ok) {
        setMessage(instData.error || "אין הרשאה");
        setInstitutions([]);
      } else {
        setMessage(instData.message ?? null);
        setInstitutions(
          (instData.institutions ?? []).map((i: Institution) => ({
            ...i,
            contacts:
              typeof i.contacts === "string"
                ? JSON.parse(i.contacts)
                : i.contacts ?? [],
            linked_clusters:
              typeof i.linked_clusters === "string"
                ? JSON.parse(i.linked_clusters)
                : i.linked_clusters ?? [],
          })),
        );
      }
      setLoading(false);
    })();
  }, []);

  const isAdmin = role === "super_admin" || role === "area_manager";

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>{isAdmin ? "מוסדות הצוות" : "המוסד שלי"}</h1>
            <p className="lede">
              המוסד מהקטלוג (חוברת2) — אשכולות מקושרים מופיעים במפה לרכז
            </p>
          </div>
          {isAdmin && (
            <Link href="/institutions" className="export">
              לקטלוג המלא
            </Link>
          )}
        </header>

        {loading && <p className="lede">טוען…</p>}
        {!loading && message && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            {message}
          </p>
        )}
        {!loading && !message && institutions.length === 0 && (
          <p className="lede" style={{ color: "var(--sand)" }}>
            לא שויך מוסד. מנהל צריך לבחור מוסד למשתמש במסך משתמשים.
          </p>
        )}

        {institutions.map((inst) => {
          const contacts = (inst.contacts ?? []) as Contact[];
          const clusters = (inst.linked_clusters ?? []) as LinkedCluster[];
          return (
            <section key={inst.id} className="panel-form" style={{ marginBottom: "1.25rem" }}>
              <h2 style={{ margin: "0 0 0.35rem", fontSize: "1.25rem" }}>{inst.name}</h2>
              <p className="lede" style={{ marginBottom: "0.75rem" }}>
                {[inst.kind, inst.settlement_name, inst.district]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>

              {contacts.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <strong>אנשי מפתח</strong>
                  <ul style={{ margin: "0.35rem 0 0", paddingInlineStart: "1.2rem" }}>
                    {contacts.map((c) => (
                      <li key={c.id}>
                        {c.full_name}
                        {c.role_title ? ` (${c.role_title})` : ""}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <strong>אשכולות מקושרים ({clusters.length})</strong>
              {clusters.length === 0 ? (
                <p className="lede" style={{ marginTop: "0.35rem" }}>
                  עדיין אין אשכולות — במפה לחצו על אשכול ואז «קשר למוסד».
                </p>
              ) : (
                <div className="table-wrap" style={{ marginTop: "0.5rem" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>אשכול</th>
                        <th>יישוב</th>
                        <th>% ימין</th>
                        <th>הצבעה</th>
                        <th>בז״ב</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clusters.map((c) => (
                        <tr key={c.ashkol}>
                          <td>{c.ashkol}</td>
                          <td>{c.settlement_name}</td>
                          <td>{Number(c.right_pct).toFixed(1)}</td>
                          <td>{Number(c.turnout_pct).toFixed(1)}</td>
                          <td>{c.bzb}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
