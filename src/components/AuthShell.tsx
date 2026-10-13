"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppNav } from "./AppNav";
import type { SessionUser } from "@/lib/auth";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (path === "/login" || path === "/register") {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (cancelled) return;
      if (!data.user) {
        router.replace("/login");
        return;
      }
      setUser(data.user);
      setProgress(data.progress);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [path, router]);

  if (path === "/login" || path === "/register") return <>{children}</>;
  if (!ready || !user) {
    return (
      <main className="shell-loading" aria-busy="true" aria-live="polite">
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-block" />
        <p className="lede" style={{ color: "var(--sand)", margin: 0 }}>
          טוען…
        </p>
      </main>
    );
  }

  return (
    <>
      <AppNav user={user} progress={progress} />
      {children}
    </>
  );
}
