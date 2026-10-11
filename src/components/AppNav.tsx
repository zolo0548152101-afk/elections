"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

export function AppNav({
  user,
  progress,
}: {
  user: SessionUser;
  progress?: { done: number; total: number };
}) {
  const path = usePathname();
  const router = useRouter();

  const links = [{ href: "/", label: "מפה" }];
  if (user.role === "super_admin" || user.role === "area_manager") {
    links.push(
      { href: "/users", label: "משתמשים" },
      { href: "/institutions", label: "קטלוג מוסדות" },
      { href: "/groups", label: "מוסדות הצוות" },
    );
  } else {
    // Same entity as institutions — coordinator only sees their linked מוסד.
    links.push({ href: "/groups", label: "המוסד שלי" });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((100 * progress.done) / progress.total)
      : null;

  return (
    <nav className="app-nav">
      <div className="app-nav-links">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </div>
      <div className="app-nav-user">
        {pct != null && (
          <span className="progress-pill">
            התקדמות {progress!.done}/{progress!.total} ({pct}%)
          </span>
        )}
        <span>
          {user.full_name} · {roleLabel(user.role)}
        </span>
        <button type="button" onClick={logout}>
          יציאה
        </button>
      </div>
    </nav>
  );
}

function roleLabel(role: SessionUser["role"]) {
  if (role === "super_admin") return "מנהל על";
  if (role === "area_manager") return "מנהל אזור";
  return "רכז";
}
