"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SHIRT_SIZES } from "@/lib/activists";

type Hit = { id: number; name: string; settlement_name: string | null; label: string };

export function RegisterPoster() {
  const params = useSearchParams();
  const preset = params.get("institution") ?? "";
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [institution, setInstitution] = useState<Hit | null>(null);
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [shirt, setShirt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; institution: string; shirt: string } | null>(
    null,
  );

  useEffect(() => {
    const id = Number(preset);
    if (!Number.isInteger(id) || id <= 0) return;
    let cancelled = false;
    fetch(`/api/register?institution=${id}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.institution) {
          setInstitution(data.institution);
          setQuery(data.institution.label);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [preset]);

  useEffect(() => {
    if (institution && query === institution.label) {
      setHits([]);
      return;
    }
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(() => {
      fetch(`/api/register/institutions?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data) => setHits(data.hits ?? []))
        .catch(() => setHits([]));
    }, 180);
    return () => window.clearTimeout(handle);
  }, [query, institution]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!institution) {
      setError("בחרו מוסד מהרשימה");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institution_id: institution.id,
          full_name: fullName,
          mobile,
          shirt_size: shirt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "שגיאה");
        return;
      }
      setDone({
        name: data.full_name,
        institution: data.institution_name,
        shirt: data.shirt_size,
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
        <h1>רישום פעילים</h1>
        {done ? (
          <div className="register-success">
            <p>ההרשמה נקלטה.</p>
            <p>
              {done.name} · {done.institution} · מידה {done.shirt}
            </p>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label>
              מוסד
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setInstitution(null);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                placeholder="חפשו מוסד או יישוב"
                autoComplete="off"
              />
            </label>
            {open && hits.length > 0 && (
              <ul className="register-hits">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setInstitution(hit);
                        setQuery(hit.label);
                        setOpen(false);
                      }}
                    >
                      {hit.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <label>
              נייד
              <input
                value={mobile}
                onChange={(event) => setMobile(event.target.value)}
                inputMode="tel"
                autoComplete="tel"
                placeholder="05XXXXXXXX"
              />
            </label>
            <label>
              שם מלא
              <input
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>
            <label>
              מידת חולצה
              <select value={shirt} onChange={(event) => setShirt(event.target.value)}>
                <option value="">בחרו מידה</option>
                {SHIRT_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="register-error">{error}</p> : null}
            <button type="submit" className="register-submit" disabled={busy}>
              {busy ? "שולח…" : "שליחה"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
