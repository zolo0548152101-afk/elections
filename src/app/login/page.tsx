"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
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

  return (
    <main className="login-main">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>התחברות</h1>
        <p className="lede">ניהול יום בחירות</p>
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
        {error && <p className="error">{error}</p>}
        <button type="submit" className="export" disabled={loading}>
          {loading ? "…" : "כניסה"}
        </button>
      </form>
    </main>
  );
}
