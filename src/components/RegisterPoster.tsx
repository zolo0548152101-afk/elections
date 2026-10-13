"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SHIRT_SIZES } from "@/lib/activists";

type Hit = { id: number; name: string; settlement_name: string | null; label: string };

const TIMELINE = [
  { label: "בוקר", note: "מצביעים בעצמם, חוזרים לישיבה", tick: "black" },
  { label: "13:00", note: "יוצאים לעיר", tick: "black" },
  { label: "15:00", note: "כינוס וחלוקה לזוגות ורחובות", tick: "navy" },
  { label: "סבב", note: "40–60 דקות של דפיקות", tick: "gold" },
  { label: "כינוס", note: "אוכל, שתייה, שירה – ושוב לסבב", tick: "gold" },
  { label: "21:00", note: "ספרינט אחרון: ממשיכים בכל הכח", tick: "wine" },
  { label: "22:00", note: "הקלפיות נסגרות. עובדים עד הדקה האחרונה", tick: "red" },
];

const SCRIPTS = [
  {
    quote: "כן, כבר הצבענו",
    reply: "כל הכבוד! יש עוד מישהו בבית שעוד לא הצביע?",
  },
  {
    quote: "עוד לא / אחר כך",
    reply: "הקלפי פתוחה עד 22:00. זה הזמן לצאת! צריך הסעה? אנחנו מסדרים.",
  },
  {
    quote: "לא יודע איפה הקלפי שלי",
    reply: "שנייה, בודקים יחד בטלפון שלכם. סורקים את הברקוד למטה.",
  },
  {
    quote: "לא מעניין אותי / כל הפוליטיקאים מושחתים",
    reply: "אח שלי, אלה בחירות גורליות. עם ישראל צריך אותך. בשבילנו – בוא, צא להצביע, ננצח בענק!",
  },
];

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
      <header className="register-hero">
        <img src="/brand/yotzim-logo.png" alt="יוצאים מצביעים את הימין" />
        <div>
          <p className="register-kicker">27.10 · יום שלישי · מבצע דלת לדלת</p>
          <h1>היום שלנו: 15:00 עד 22:00</h1>
          <p>
            ההצלחה לא נמדדת במי שהתחיל הכי חזק – אלא במי שמחזיק את הדופק עד סגירת הקלפיות.
          </p>
        </div>
      </header>

      <div className="register-timeline" aria-label="לוח הזמנים">
        {TIMELINE.map((item) => (
          <div key={item.label}>
            <span className={`tick tick-${item.tick}`} />
            <strong>{item.label}</strong>
            <p>{item.note}</p>
          </div>
        ))}
      </div>

      <section className="register-script">
        <h2>מה אומרים בדלת</h2>
        <div className="register-opener">
          <p>פותחים עם אמונה בלב וחיוך על הפנים</p>
          <strong>״ערב טוב! אנחנו מתנדבים ממטה ימין מנצח. רק רצינו לוודא – כבר הספקתם להצביע היום?״</strong>
        </div>
        <div className="register-cards">
          {SCRIPTS.map((card) => (
            <article key={card.quote}>
              <strong>״{card.quote}״</strong>
              <p>{card.reply}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="register-card">
        <h2>רישום פעילים</h2>
        {done ? (
          <div className="register-success">
            <p>ההרשמה נקלטה.</p>
            <p>
              {done.name} · {done.institution} · מידה {done.shirt}
            </p>
            <p>היום שלנו: 15:00 עד 22:00.</p>
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
              {busy ? "שולח…" : "נרשמים למבצע"}
            </button>
          </form>
        )}
      </section>

      <section className="register-where">
        <div>
          <h2>איפה אני מצביע? סורקים ובודקים</h2>
          <p>
            הבוחר מזיז בעצמו בטלפון שלו מספר תעודת זהות ותאריך הנפקה, ומקבל את כתובת הקלפי.
          </p>
          <a href="https://gov.il/apps/moin/bocharim">gov.il/apps/moin/bocharim</a>
        </div>
      </section>

      <p className="register-footer">תזכירו לכל בוחר: לקחת תעודה מזהה עם תמונה!</p>
    </main>
  );
}
