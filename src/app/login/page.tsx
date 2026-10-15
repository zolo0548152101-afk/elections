"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FormMsg } from "@/components/FormMsg";
import { useTimedFlash } from "@/hooks/useTimedFlash";
import { Quip } from "@/components/Quip";
import { LOGIN_LINES } from "@/lib/quips";

const CONNECTING = "מחברים שמים וארץ, סבלנות…";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const infoFlash = useTimedFlash(5000);
  const [loading, setLoading] = useState(false);
  const [previewAvailable, setPreviewAvailable] = useState(false);
  const [showPreviewPick, setShowPreviewPick] = useState(false);
  // Until we know whether test entry is on, show a short line instead of a form that would jump.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/preview-entry")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        // On test links, open straight on the role buttons (as before). Production never gets here.
        if (data?.enabled) {
          setPreviewAvailable(true);
          setShowPreviewPick(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enterAs(role: "super_admin" | "area_manager" | "coordinator") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/preview-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      router.push("/");
      router.refresh();
      // Keep "connecting" on screen until the home page takes over.
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setLoading(false);
    }
  }

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    infoFlash.clear();
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      router.push("/");
      router.refresh();
      // Keep "connecting" on screen until the home page takes over.
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
      setLoading(false);
    }
  }

  async function onForgot(channel: "whatsapp" | "sms") {
    setLoading(true);
    setError(null);
    infoFlash.clear();
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile, channel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      const via = channel === "sms" ? "SMS" : "WhatsApp";
      infoFlash.flash("ok", data.message || `נשלח קוד זמני ב-${via}`);
      setMode("login");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-main">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (mode === "login") void onLogin(e);
          else void onForgot("whatsapp");
        }}
      >
        <h1>{showPreviewPick ? "כניסה לבדיקה" : mode === "login" ? "התחברות" : "סיסמה זמנית"}</h1>
        <p className="login-quip">
          <Quip list={LOGIN_LINES} />
        </p>
        {loading && (
          <p className="login-connecting" role="status">
            {CONNECTING}
          </p>
        )}
        {!checked && !loading ? <p className="lede">{CONNECTING}</p> : null}
        {checked && showPreviewPick ? (
          <>
            <p className="lede">בתור מי נכנסים?</p>
            {error && <FormMsg kind="err">{error}</FormMsg>}
            <button type="button" className="export" disabled={loading} onClick={() => void enterAs("super_admin")}>
              מנהל
            </button>
            <button type="button" className="export" disabled={loading} onClick={() => void enterAs("area_manager")}>
              רכז על
            </button>
            <button type="button" className="export" disabled={loading} onClick={() => void enterAs("coordinator")}>
              רכז
            </button>
            <button
              type="button"
              className="reset"
              disabled={loading}
              onClick={() => {
                setShowPreviewPick(false);
                setError(null);
              }}
              style={{ marginTop: "0.65rem", width: "100%" }}
            >
              התחברות עם נייד וסיסמה
            </button>
          </>
        ) : null}
        {checked && !showPreviewPick ? (
          <>
        <p className="lede">
          {mode === "login"
            ? "ניהול יום בחירות"
            : "נשלח אליכם קוד בן 5 ספרות ב-WhatsApp או ב-SMS, תקף ל־5 דקות. הסיסמה הקבועה לא משתנה."}
        </p>
        <label>
          נייד
          <input
            type="tel"
            dir="ltr"
            inputMode="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            required
            autoComplete="username"
            placeholder="05…"
          />
        </label>
        {mode === "login" && (
          <label>
            סיסמה
            <input
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
        )}
        {error && <FormMsg kind="err">{error}</FormMsg>}
        {infoFlash.msg && (
          <FormMsg kind={infoFlash.kind}>{infoFlash.msg}</FormMsg>
        )}
        {mode === "login" ? (
          <button type="submit" className="export" disabled={loading}>
            {loading ? "מתחברים…" : "כניסה"}
          </button>
        ) : (
          <>
            <button type="submit" className="export" disabled={loading}>
              {loading ? "…" : "שלח ב-WhatsApp"}
            </button>
            <button
              type="button"
              className="export"
              disabled={loading}
              onClick={() => void onForgot("sms")}
            >
              {loading ? "…" : "שלח ב-SMS"}
            </button>
          </>
        )}
        <button
          type="button"
          className="reset"
          disabled={loading}
          onClick={() => {
            setMode((m) => (m === "login" ? "forgot" : "login"));
            setError(null);
            infoFlash.clear();
          }}
          style={{ marginTop: "0.65rem", width: "100%" }}
        >
          {mode === "login" ? "שכחתי סיסמה / כניסה חד-פעמית" : "חזרה להתחברות"}
        </button>
        {previewAvailable && mode === "login" ? (
          <button
            type="button"
            className="reset"
            disabled={loading}
            onClick={() => {
              setShowPreviewPick(true);
              setError(null);
              infoFlash.clear();
            }}
            style={{ width: "100%" }}
          >
            כניסה לבדיקה
          </button>
        ) : null}
          </>
        ) : null}
      </form>
    </main>
  );
}
