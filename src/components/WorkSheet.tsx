"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { WorkSheet as WorkSheetData } from "@/lib/work-sheet";

const SheetMap = dynamic(
  () => import("@/components/SheetMap").then((m) => m.SheetMap),
  { ssr: false },
);

function fmtInt(n: number) {
  return Math.round(n).toLocaleString("he-IL");
}

function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function sectionPaths(section: WorkSheetData["sections"][number]) {
  return section.streets.flatMap((s) => s.paths);
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
        (s) => s.marker != null || sectionPaths(s).length > 0,
      ).length,
    [sheet],
  );
  const mapsReady = mapCount === 0 || readyMaps >= mapCount;
  const today = useMemo(
    () => new Date().toLocaleDateString("he-IL"),
    [],
  );

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

  return (
    <main className="sheet-doc">
      <header className="sheet-head">
        <div>
          <p className="eyebrow">דף עבודה</p>
          <h1>{sheet.title}</h1>
          {sheet.subtitle ? <p className="lede">{sheet.subtitle}</p> : null}
          <p className="lede">{today}</p>
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="export"
            disabled={!mapsReady}
            onClick={() => window.print()}
          >
            {mapsReady ? "שמירה כ-PDF" : "טוען מפה…"}
          </button>
        </div>
      </header>

      {sheet.sections.length === 0 ? (
        <p className="lede">אין אשכולות מקושרים.</p>
      ) : (
        sheet.sections.map((section) => {
          const paths = sectionPaths(section);
          const hasMap = section.marker != null || paths.length > 0;
          return (
            <section className="sheet-section" key={section.cluster.ashkol}>
              <h2>
                {section.cluster.settlement_name} · אשכול{" "}
                <bdi dir="ltr">{section.cluster.ashkol}</bdi>
              </h2>
              <p className="lede">
                {section.institutions.length
                  ? section.institutions
                      .map((i) =>
                        [i.name, i.kind, i.settlement_name].filter(Boolean).join(" · "),
                      )
                      .join(" | ")
                  : "לא קושר מוסד"}
              </p>
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
                  <dt>מחל</dt>
                  <dd><bdi dir="ltr">{fmtPct(section.cluster.likud_pct)}</bdi></dd>
                </div>
                <div>
                  <dt>קלפיות</dt>
                  <dd><bdi dir="ltr">{fmtInt(section.cluster.ballot_count)}</bdi></dd>
                </div>
              </dl>
              {hasMap ? (
                <SheetMap
                  marker={section.marker}
                  paths={paths}
                  onReady={() => setReadyMaps((n) => n + 1)}
                />
              ) : (
                <p className="lede">אין מיקום למפה.</p>
              )}
              <h3>רחובות</h3>
              {section.streets.length === 0 ? (
                <p className="lede">אין רחובות מקושרים לאשכול זה.</p>
              ) : (
                <table className="sheet-streets">
                  <thead>
                    <tr>
                      <th>רחוב</th>
                      <th>סטטוס</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.streets.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name_he}</td>
                        <td>{s.done ? "בוצע" : "פתוח"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {section.streets_truncated ? (
                <p className="lede">
                  מוצגים {section.streets.length} מתוך {section.street_total} רחובות.
                </p>
              ) : null}
            </section>
          );
        })
      )}
    </main>
  );
}
