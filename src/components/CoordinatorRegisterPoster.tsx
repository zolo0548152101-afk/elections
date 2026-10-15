"use client";

import { useState } from "react";
import { COORDINATOR_SIGNUP_KINDS } from "@/lib/coordinator-signups";
import { Quip } from "@/components/Quip";
import { SIGNUP_THANKS_COORDINATOR } from "@/lib/quips";

type Done = { name: string; institution: string; kind: string };

/** Public coordinator sign-up, in the same poster layout as the activist sign-up. */
export function CoordinatorRegisterPoster() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [mobile, setMobile] = useState("");
  const [institution, setInstitution] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/register/coordinators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          mobile,
          institution_name: institution,
          institution_kind: kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה");
        return;
      }
      setDone({
        name: `${data.first_name} ${data.last_name}`,
        institution: data.institution_name,
        kind: data.institution_kind,
      });
    } catch {
      setError("שגיאה בשליחה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="register-poster">
      <header className="register-top">
        <strong>מטה ימין מנצח</strong>
      </header>
      <section className="register-hero">
        <img src="/brand/yotzim-slogan.jpg" alt="יוצאים. מצביעים. מצילים את הימין!" />
      </section>
      <section className="register-card">
        <h1>רישום רכזים</h1>
        {done ? (
          <div className="register-success" role="status">
            <p>ההרשמה נקלטה. <Quip list={SIGNUP_THANKS_COORDINATOR} /></p>
            <p>
              {done.name} · {done.institution} · {done.kind}
            </p>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label>
              שם פרטי
              <input
                value={firstName}
                onChange={(event) => {
                  setFirstName(event.target.value);
                  setError(null);
                }}
                autoComplete="given-name"
                required
              />
            </label>
            <label>
              שם משפחה
              <input
                value={lastName}
                onChange={(event) => {
                  setLastName(event.target.value);
                  setError(null);
                }}
                autoComplete="family-name"
                required
              />
            </label>
            <label>
              נייד
              <input
                value={mobile}
                onChange={(event) => {
                  setMobile(event.target.value);
                  setError(null);
                }}
                inputMode="tel"
                autoComplete="tel"
                placeholder="05XXXXXXXX"
                required
              />
            </label>
            <label>
              סוג מוסד
              <select value={kind} onChange={(event) => {
                  setKind(event.target.value);
                  setError(null);
                }} required>
                <option value="">בחרו סוג מוסד</option>
                {COORDINATOR_SIGNUP_KINDS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              שם המוסד
              <input
                value={institution}
                onChange={(event) => {
                  setInstitution(event.target.value);
                  setError(null);
                }}
                autoComplete="organization"
                required
              />
            </label>
            {error ? (
              <p className="register-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="register-submit" disabled={busy}>
              {busy ? "שולח…" : "שליחה"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
