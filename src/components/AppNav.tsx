"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import { ShowMore } from "@/components/ShowMore";

export function AppNav({
  user,
  progress,
}: {
  user: SessionUser;
  progress?: { done: number; total: number };
}) {
  const path = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: "/", label: "מפה" },
    {
      href: "/institutions",
      label: user.role === "coordinator" ? "המוסד שלי" : "מוסדות",
    },
  ];
  if (user.role === "super_admin" || user.role === "area_manager") {
    links.splice(1, 0, { href: "/users", label: "משתמשים" });
    links.push({ href: "/team/clusters", label: "אשכולות" });
    links.push({ href: "/team/coordinators", label: "רכזים" });
    if (user.role === "super_admin") {
      links.push({ href: "/team/managers", label: "רכזי על" });
    }
    links.push({ href: "/links", label: "קישורים" });
  }

  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

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
          </span>
        )}
        <span className="app-nav-who">
          <ShowMore text={user.full_name} /> · {roleLabel(user.role)}
        </span>
        <button type="button" onClick={logout}>
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
