"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { WorkSheet as WorkSheetData } from "@/lib/work-sheet";
import { MAP_COLOR } from "@/lib/map-colors";

async function printSheet() {
  // Loaded with the map; makes sure each map has a fresh picture to print.
  const { prepareSheetPrint } = await import("@/components/SheetMap");
  await prepareSheetPrint();
  window.print();
}

const SheetMap = dynamic(
  () => import("@/components/SheetMap").then((m) => m.SheetMap),
  { ssr: false },
);

function fmtInt(n: number) {
  return Math.round(n).toLocaleString("he-IL");
}

function fmtMeters(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} ק״מ` : `${Math.round(m)} מ׳`;
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

type Section = WorkSheetData["sections"][number];

function sectionPaths(section: Section) {
  return section.streets.flatMap((s) => s.paths);
}

/** Streets with the most apartments first: that is where to start knocking. */
function byDoors(section: Section) {
  return [...section.streets].sort(
    (a, b) => b.door_count - a.door_count || a.name_he.localeCompare(b.name_he, "he"),
  );
}

export function WorkSheet({ endpoint }: { endpoint: string }) {
  const [sheet, setSheet] = useState<WorkSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyMaps, setReadyMaps] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(endpoint)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "שגיאה");
        return data as WorkSheetData;
      })
      .then((data) => {
        if (!cancelled) setSheet(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "שגיאה");
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const mapCount = useMemo(
    () =>
      (sheet?.sections ?? []).filter(
        (s) => s.houses.length > 0 || s.marker != null || sectionPaths(s).length > 0,
      ).length,
    [sheet],
  );
  const mapsReady = mapCount === 0 || readyMaps >= mapCount;

  // The saved PDF is named after the page title: cluster number, city and coordinator.
  useEffect(() => {
    if (!sheet || sheet.sections.length === 0) return;
    const names = [
      ...new Set(sheet.sections.flatMap((s) => s.coordinators.map((c) => c.full_name.trim()))),
    ].filter(Boolean);
    const who = names.length > 0 ? names.join(" ו") : "ללא רכז";
    const title =
      sheet.kind === "cluster"
        ? `${sheet.sections[0]!.cluster.ashkol} ${sheet.sections[0]!.cluster.settlement_name} - ${who}`
        : `${who} - ${sheet.sections.map((s) => `${s.cluster.ashkol} ${s.cluster.settlement_name}`).join(", ")}`;
    const previous = document.title;
    // Characters a file name cannot hold.
    document.title = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
    return () => {
      document.title = previous;
    };
  }, [sheet]);

  if (error) {
    return (
      <main className="sheet-doc">
        <p className="form-msg form-msg-err" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!sheet) {
    return (
      <main className="sheet-doc">
        <p className="lede">טוען את דף העבודה…</p>
      </main>
    );
  }

  const people = new Map<number, WorkSheetData["sections"][number]["coordinators"][number]>();
  for (const section of sheet.sections) {
    for (const person of section.coordinators) people.set(person.id, person);
  }
  const coordinators = [...people.values()];

  const today = new Date().toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" });

  return (
    <main className="sheet-doc">
      <header className="sheet-head">
        <div className="sheet-title">
          <p className="eyebrow">דף עבודה · {today}</p>
          <h1>{sheet.title}</h1>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="export"
            disabled={!mapsReady}
            onClick={() => void printSheet()}
          >
            {mapsReady ? "שמירה כ-PDF / הדפסה" : "טוען מפה…"}
          </button>
        </div>
      </header>

      {sheet.sections.length === 0 ? (
        <p className="lede">אין אשכולות מקושרים.</p>
      ) : (
        sheet.sections.map((section) => {
          const hasMap =
            section.houses.length > 0 || section.marker != null || sectionPaths(section).length > 0;
          const streets = byDoors(section);
          const doors = section.streets.reduce((n, s) => n + s.door_count, 0);
          const people = section.coordinators.length > 0 ? section.coordinators : coordinators;
          return (
            <section className="sheet-section" key={section.cluster.ashkol}>
              {hasMap ? (
                <SheetMap
                  houses={section.houses}
                  streets={section.streets}
                  color={section.color}
                  route={section.route}
                  onReady={() => setReadyMaps((n) => n + 1)}
                />
              ) : (
                <p className="lede sheet-nomap">אין מיקום למפה.</p>
              )}

              <div className="sheet-info">
                <div className="sheet-facts">
                  <h2>
                    {section.cluster.settlement_name} · אשכול{" "}
                    <bdi dir="ltr">{section.cluster.ashkol}</bdi>
                  </h2>
                  <dl className="sheet-stats">
                    <div>
                      <dt>בז״ב</dt>
                      <dd><bdi dir="ltr">{fmtInt(section.cluster.bzb)}</bdi></dd>
                    </div>
                    <div>
                      <dt>מצביעים</dt>
                      <dd><bdi dir="ltr">{fmtInt(section.cluster.voters)}</bdi></dd>
                    </div>
                    <div>
                      <dt>הצבעה</dt>
                      <dd><bdi dir="ltr">{fmtPct(section.cluster.turnout_pct)}</bdi></dd>
                    </div>
                    <div>
                      <dt>ימין</dt>
                      <dd><bdi dir="ltr">{fmtPct(section.cluster.right_pct)}</bdi></dd>
                    </div>
                    <div>
                      <dt>קלפיות</dt>
                      <dd><bdi dir="ltr">{fmtInt(section.cluster.ballot_count)}</bdi></dd>
                    </div>
                    <div>
                      <dt>רחובות</dt>
                      <dd><bdi dir="ltr">{fmtInt(section.street_total)}</bdi></dd>
                    </div>
                  </dl>
                  <div className="sheet-people">
                    <span className="sheet-k">רכז</span>
                    {people.length === 0 ? (
                      <span className="sheet-person">לא קושר רכז</span>
                    ) : (
                      people.map((c) => (
                        <span className="sheet-person" key={c.id}>
                          {c.full_name} · <bdi dir="ltr">{c.mobile?.trim() || "—"}</bdi>
                        </span>
                      ))
                    )}
                    {section.institutions.length > 0 ? (
                      <>
                        <span className="sheet-k">מוסד</span>
                        <span className="sheet-person">
                          {section.institutions.map((i) => i.name).join(", ")}
                        </span>
                      </>
                    ) : null}
                  </div>
                  {section.route.length > 0 ? (
                    <div className="sheet-route">
                      <span className="sheet-k">מסלול</span>
                      <ol>
                        {section.route.map((stage) => (
                          <li key={stage.stage_no}>
                            <span className="sheet-route-no" style={{ background: stage.color }}>
                              {stage.stage_no}
                            </span>
                            שלב {stage.stage_no}
                            {stage.meters > 0 ? (
                              <span className="sheet-route-len">
                                {" "}· <bdi dir="ltr">{fmtMeters(stage.meters)}</bdi>
                              </span>
                            ) : null}
                            {stage.point ? (
                              <span className="sheet-route-len">
                                {" "}· {stage.stage_no === 1 ? "התחלה" : "קיבוץ"}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}
                  <p className="sheet-legend">
                    <span className="sheet-swatch" style={{ background: section.color }} /> לא בוצע
                    <span className="sheet-swatch" style={{ background: MAP_COLOR.streetDone }} /> בוצע
                    <span className="sheet-dot" style={{ background: section.color }} /> בית
                  </p>
                </div>

                <div className="sheet-streets-box">
                  <div className="sheet-streets-head">
                    <h3>רחובות</h3>
                    <span>
                      לפי מספר דירות · סה״כ <bdi dir="ltr">{fmtInt(doors)}</bdi> דירות
                    </span>
                  </div>
                  {streets.length === 0 ? (
                    <p className="lede">אין רחובות מקושרים לאשכול זה.</p>
                  ) : (
                    <ol className="sheet-street-list">
                      {streets.map((s) => (
                        <li key={s.id} className={s.done ? "is-done" : undefined}>
                          <span className="sheet-check" aria-label={s.done ? "בוצע" : "לא בוצע"}>
                            {s.done ? "✓" : ""}
                          </span>
                          <span className="sheet-street-name">{s.name_he}</span>
                          <span className="sheet-street-num">
                            {s.door_count > 0 ? (
                              <>
                                <bdi dir="ltr">{fmtInt(s.door_count)}</bdi> דירות
                              </>
                            ) : (
                              "—"
                            )}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {section.streets_truncated ? (
                    <p className="lede">
                      מוצגים {section.streets.length} מתוך {section.street_total} רחובות.
                    </p>
                  ) : null}
                </div>
              </div>
            </section>
          );
        })
      )}
    </main>
  );
}
