"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CARDS = [
  {
    href: "/links/institution-clusters",
    title: "מוסד ↔ אשכולות",
    lede: "שייכו אשכולות למוסד — ברגע שרכז לוחץ על אשכול בטבלה, הוא מופיע במפה.",
  },
  {
    href: "/links/managers",
    title: "רכז על ↔ רכזים",
    lede: "שייכו רכזים תחת רכז על. היררכיה: רכז → רכז על → מנהל.",
  },
  {
    href: "/links/coordinators",
    title: "רכז ↔ מוסד",
    lede: "שייכו רכז למוסד — רק אשכולות המקושרים למוסד יופיעו אצלו במפה ובטבלה.",
  },
];

export default function LinksHubPage() {
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        const role = d.user?.role;
        const ok = role === "super_admin" || role === "area_manager";
        setAllowed(ok);
        if (!ok) router.replace("/");
      })
      .catch(() => {
        setAllowed(false);
        router.replace("/login");
      });
  }, [router]);

  if (allowed == null) {
    return (
      <main>
        <div className="dash">
          <p className="lede">טוען…</p>
        </div>
      </main>
    );
  }

  if (!allowed) return null;

  return (
    <main>
      <div className="dash">
        <header className="hero">
          <div>
            <p className="eyebrow">ניהול</p>
            <h1>קישורים</h1>
            <p className="lede">
              עריכת שיוכים בהיררכיה: רכז → רכז על → מנהל. כל דף ניתן לעריכה ישירות.
            </p>
          </div>
        </header>
        <div className="links-hub">
          {CARDS.map((c) => (
            <Link key={c.href} href={c.href} className="links-card">
              <h2>{c.title}</h2>
              <p>{c.lede}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
