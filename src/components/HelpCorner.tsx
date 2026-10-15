"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { COORDINATOR_START, faqFor, guidesFor, type Guide } from "@/lib/guides";
import { markTourSeen, runTour, tourSeen } from "@/lib/tour";

/**
 * Help corner (bottom left): guides for this role with "הראו לי" tours, and FAQ.
 * Coordinators get the start tour once, on their first visit to the map.
 */
export function HelpCorner({ role }: { role: string }) {
  const path = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"guides" | "faq">("guides");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const guides = useMemo(() => guidesFor(role), [role]);
  const faq = useMemo(() => faqFor(role), [role]);
  const here = guides.filter((g) => g.path === path);
  const rest = guides.filter((g) => g.path !== path);

  function start(guide: Guide) {
    setOpen(false);
    if (guide.path !== path) {
      router.push(`${guide.path}?tour=${encodeURIComponent(guide.id)}`);
      return;
    }
    // Let the panel close and the page settle before highlighting.
    window.setTimeout(() => runTour(guide, () => markTourSeen(guide.id)), 250);
  }

  // ?tour=<id> from another page, and the coordinator's first-visit tour.
  useEffect(() => {
    const id = params.get("tour");
    const guide = id ? guides.find((g) => g.id === id) : undefined;
    const first =
      !guide && role === "coordinator" && path === COORDINATOR_START.path && !tourSeen(COORDINATOR_START.id)
        ? COORDINATOR_START
        : undefined;
    const target = guide ?? first;
    if (!target) return;
    // The map and its cards load asynchronously; give them a moment.
    const t = window.setTimeout(() => {
      runTour(target, () => markTourSeen(target.id));
      if (guide) router.replace(path);
    }, path === "/" ? 2500 : 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per page visit
  }, [path, role]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const item = (g: Guide) => (
    <li key={g.id}>
      <div>
        <strong>{g.title}</strong>
        <span>{g.summary}</span>
      </div>
      <button type="button" className="help-show" onClick={() => start(g)}>
        הראו לי
      </button>
    </li>
  );

  return (
    <div className="help-corner" ref={panelRef} data-help-corner>
      {open && (
        <div className="help-panel" role="dialog" aria-label="עזרה ומדריכים">
          <div className="help-head">
            <strong>עזרה ומדריכים</strong>
            <button type="button" className="help-close" aria-label="סגור" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          <div className="help-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "guides"} onClick={() => setTab("guides")}>
              מדריכים
            </button>
            <button type="button" role="tab" aria-selected={tab === "faq"} onClick={() => setTab("faq")}>
              שאלות נפוצות
            </button>
          </div>
          {tab === "guides" ? (
            <div className="help-body">
              {here.length > 0 && (
                <>
                  <p className="help-label">בדף הזה</p>
                  <ul className="help-list">{here.map(item)}</ul>
                </>
              )}
              {rest.length > 0 && (
                <>
                  <p className="help-label">עוד מדריכים</p>
                  <ul className="help-list">{rest.map(item)}</ul>
                </>
              )}
            </div>
          ) : (
            <div className="help-body">
              <ul className="help-faq">
                {faq.map((f, i) => (
                  <li key={f.q}>
                    <button
                      type="button"
                      aria-expanded={openFaq === i}
                      onClick={() => setOpenFaq((cur) => (cur === i ? null : i))}
                    >
                      {f.q}
                    </button>
                    {openFaq === i && <p>{f.a}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        className="help-fab"
        aria-expanded={open}
        aria-label="עזרה ומדריכים"
        onClick={() => setOpen((v) => !v)}
      >
        <span aria-hidden="true">?</span> עזרה
      </button>
    </div>
  );
}
