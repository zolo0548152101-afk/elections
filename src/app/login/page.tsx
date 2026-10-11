"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "שגיאה");
    } finally {
      setLoading(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "שגיאה");
      setInfo(data.message || "נשלחה סיסמה זמנית ב-WhatsApp");
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
        onSubmit={mode === "login" ? onLogin : onForgot}
      >
        <h1>{mode === "login" ? "התחברות" : "סיסמה זמנית"}</h1>
        <p className="lede">
          {mode === "login"
            ? "ניהול יום בחירות"
            : "נשלח אליכם ב-WhatsApp סיסמה זמנית לכניסה חד-פעמית."}
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
        {error && <p className="error">{error}</p>}
        {info && <p className="form-msg">{info}</p>}
        <button type="submit" className="export" disabled={loading}>
          {loading
            ? "…"
            : mode === "login"
              ? "כניסה"
              : "שלח סיסמה זמנית ב-WhatsApp"}
        </button>
        <button
          type="button"
          className="reset"
          disabled={loading}
          onClick={() => {
            setMode((m) => (m === "login" ? "forgot" : "login"));
            setError(null);
            setInfo(null);
          }}
          style={{ marginTop: "0.65rem", width: "100%" }}
        >
          {mode === "login" ? "שכחתי סיסמה / כניסה חד-פעמית" : "חזרה להתחברות"}
        </button>
      </form>
    </main>
  );
}
