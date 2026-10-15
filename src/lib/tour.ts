"use client";

import { driver, type DriveStep } from "driver.js";
import "driver.js/dist/driver.css";
import type { Guide } from "@/lib/guides";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function visible(selector: string): Element | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? el : null;
}

/**
 * Run a guide as a driver.js tour, in Hebrew and RTL.
 * Steps whose element is missing are shown as a centered card instead of being skipped,
 * so the explanation is never lost.
 */
export function runTour(guide: Guide, onDone?: () => void) {
  const steps = guide.steps;

  const tour = driver({
    showProgress: steps.length > 1,
    progressText: "{{current}} מתוך {{total}}",
    nextBtnText: "הבא ←",
    prevBtnText: "→ הקודם",
    doneBtnText: "סיימתי 💪",
    allowClose: true,
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: "app-tour",
    steps: steps.map(
      (s): DriveStep => ({
        // Resolved when the step shows: a missing element becomes a centered card.
        element: s.element ? (() => visible(s.element!) as Element) : undefined,
        // No fixed side: driver.js picks the side that fits (big targets like the map need top/left).
        popover: { title: s.title, description: s.body },
      }),
    ),
    onNextClick: async () => {
      const next = (tour.getActiveIndex() ?? 0) + 1;
      if (next >= steps.length) {
        tour.destroy();
        return;
      }
      const { open, isOpen, element } = steps[next]!;
      const alreadyOpen = isOpen ? Boolean(document.querySelector(isOpen)) : Boolean(element && visible(element));
      if (open && !alreadyOpen) {
        document.querySelector<HTMLElement>(open)?.click();
        await wait(350);
      }
      tour.moveNext();
    },
    onDestroyed: () => onDone?.(),
  });
  tour.drive();
  return tour;
}

const SEEN_PREFIX = "tour-seen:";

export function tourSeen(id: string): boolean {
  try {
    return localStorage.getItem(SEEN_PREFIX + id) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen(id: string) {
  try {
    localStorage.setItem(SEEN_PREFIX + id, "1");
  } catch {
    /* private mode: the tour may show again, which is fine */
  }
}
