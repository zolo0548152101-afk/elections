"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/links/institution-clusters", label: "מוסד ↔ אשכולות" },
  { href: "/links/managers", label: "רכז על ↔ רכזים" },
  { href: "/links/coordinators", label: "רכז ↔ מוסד" },
];

export function LinksNav() {
  const path = usePathname();
  return (
    <nav className="links-subnav" aria-label="קישורי היררכיה">
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={path === item.href ? "active" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
