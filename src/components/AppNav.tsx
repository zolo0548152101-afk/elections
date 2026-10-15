"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { ShowMore } from "@/components/ShowMore";
import { progressQuip } from "@/lib/quips";

export function AppNav({
  user,
  progress,
}: {
  user: SessionUser;
  progress?: { done: number; total: number };
}) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // RTL: the first link is the rightmost.
  const institutionsLink = {
    href: "/institutions",
    label: "מוסדות",
  };
  const activistsLink = { href: "/activists", label: "הרשמת פעילים" };
  const links: { href: string; label: string }[] =
    user.role === "super_admin" || user.role === "area_manager"
      ? [
          { href: "/users", label: "משתמשים" },
          { href: "/", label: "מפה" },
          institutionsLink,
          { href: "/team/clusters", label: "אשכולות" },
          { href: "/team/coordinators", label: "רכזים" },
          ...(user.role === "super_admin" ? [{ href: "/team/managers", label: "רכזי על" }] : []),
          { href: "/links", label: "קישורים" },
          // Registrations sit at the far left (end of the row in RTL).
          activistsLink,
          ...(user.role === "super_admin"
            ? [{ href: "/coordinator-signups", label: "הרשמת רכזים" }]
            : []),
        ]
      : [
          { href: "/", label: "מפה" },
          institutionsLink,
          { href: "/team/clusters", label: "אשכולות" },
          activistsLink,
        ];

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((100 * progress.done) / progress.total)
      : null;

  return (
    <nav className="app-nav" aria-label="ניווט ראשי">
      <div className="app-nav-top">
        <button
          type="button"
          className="app-nav-menu-btn"
          aria-expanded={menuOpen}
          aria-controls="app-nav-links"
          onClick={() => setMenuOpen((v) => !v)}
        >
          {menuOpen ? "סגור תפריט" : "תפריט"}
        </button>
        <div
          id="app-nav-links"
          className={`app-nav-links${menuOpen ? " is-open" : ""}`}
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={
                path === l.href ||
                (l.href !== "/" && path.startsWith(l.href + "/"))
                  ? "active"
                  : ""
              }
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="app-nav-user">
        {pct != null && (
          <span className="progress-pill">
            התקדמות {progress!.done}/{progress!.total} אשכולות ({pct}%)
            <span className="progress-quip"> · {progressQuip(pct)}</span>
          </span>
        )}
        <span className="app-nav-who">
          <ShowMore text={user.full_name} /> · {roleLabel(user.role)}
        </span>
        <button type="button" className="app-nav-logout" onClick={logout} title="יציאה מהמערכת">
          יציאה
        </button>
      </div>
    </nav>
  );
}

function roleLabel(role: SessionUser["role"]) {
  if (role === "super_admin") return "מנהל";
  if (role === "area_manager") return "רכז על";
  return "רכז";
}
