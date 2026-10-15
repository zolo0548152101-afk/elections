"use client";

import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import type { Guide, TaskId, TourStep } from "@/lib/guides";
import { tourBridge } from "@/lib/tour-bridge";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function visible(selector: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? el : null;
}

/* ------------------------------------------------------------------ */
/* Visible cursor for "עשו את זה בשבילי"                                */
/* ------------------------------------------------------------------ */

let cursorEl: HTMLDivElement | null = null;

function cursor(): HTMLDivElement {
  if (cursorEl && document.body.contains(cursorEl)) return cursorEl;
  const el = document.createElement("div");
  el.className = "tour-cursor";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#1d4ed8" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  el.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight / 2}px)`;
  document.body.appendChild(el);
  cursorEl = el;
  return el;
}

async function moveTo(x: number, y: number) {
  const el = cursor();
  el.style.opacity = "1";
  el.style.transform = `translate(${x}px, ${y}px)`;
  await wait(650);
}

async function tap(x: number, y: number) {
  await moveTo(x, y);
  const ring = document.createElement("div");
  ring.className = "tour-click";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  document.body.appendChild(ring);
  setTimeout(() => ring.remove(), 600);
  await wait(250);
}

async function tapElement(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  await wait(250);
  const r = el.getBoundingClientRect();
  await tap(r.left + r.width / 2, r.top + r.height / 2);
  el.click();
  await wait(300);
}

function hideCursor() {
  if (cursorEl) cursorEl.style.opacity = "0";
}

/* ------------------------------------------------------------------ */
/* Hands-on tasks: how to check them, do them, and undo them           */
/* ------------------------------------------------------------------ */

type Undo = {
  /** Cluster selection before the tour. */
  ashkol?: string;
  /** Route of each cluster the tour touched, as it was before. */
  routes: Map<string, unknown>;
  /** Street id → done state before the tour. */
  marks: Map<string, boolean>;
  menuWasOpen?: boolean;
};

const checkedStreets = () =>
  document.querySelectorAll<HTMLInputElement>(".cluster-street-list input[type=checkbox]:checked").length;
const stages = () => tourBridge.getStages?.() ?? [];
/** Changes whenever a start/pickup point is added or moved. */
const pointsKey = () => JSON.stringify(stages().map((s) => s.point && [s.point.lat, s.point.lng]));
/** Changes whenever a route line gets a new point. */
const drawsKey = () =>
  JSON.stringify(stages().map((s) => (s.draws ?? []).map((d) => d.coordinates?.length ?? 0)));

/** A street line of the selected cluster on the map, as [lng, lat] points. */
function clusterLine(): [number, number][] | null {
  const map = tourBridge.map;
  const a = tourBridge.selectedAshkol;
  if (!map || !a || !map.getSource("eshkol-streets")) return null;
  const feats = map.querySourceFeatures("eshkol-streets").filter((f) => f.properties?.ashkol === a);
  let best: [number, number][] | null = null;
  for (const f of feats) {
    const g = f.geometry;
    const lines =
      g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      if (!best || line.length > best.length) best = line as [number, number][];
    }
  }
  return best;
}

async function snapshotRoute(undo: Undo) {
  const a = tourBridge.selectedAshkol;
  if (!a || undo.routes.has(a)) return;
  const res = await fetch(`/api/clusters/${encodeURIComponent(a)}/route`);
  if (res.ok) undo.routes.set(a, (await res.json()).stages ?? []);
}

function snapshotMarks(undo: Undo) {
  document
    .querySelectorAll<HTMLInputElement>(".cluster-street-list input[type=checkbox][data-street-id]")
    .forEach((box) => {
      const id = box.dataset.streetId!;
      if (!undo.marks.has(id)) undo.marks.set(id, box.checked);
    });
}

type Task = {
  /** Baseline taken when the step opens; `done` compares against it. */
  base: () => number | string;
  done: (base: number | string) => boolean;
  /** Perform it with the visible cursor. */
  run: () => Promise<void>;
};

const TASKS: Record<TaskId, Task> = {
  "select-cluster": {
    base: () => 0,
    done: () => Boolean(tourBridge.selectedAshkol),
    run: async () => {
      const select = document.querySelector<HTMLSelectElement>('[data-tour="cluster-select"] select');
      if (!select) return;
      await tapElement(select);
      const option = [...select.options].find((o) => o.value && o.value !== select.value);
      if (!option || tourBridge.selectedAshkol) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, option.value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await wait(1200);
    },
  },
  "mark-street": {
    base: checkedStreets,
    done: (b) => checkedStreets() > Number(b),
    run: async () => {
      const box = document.querySelector<HTMLInputElement>(
        ".cluster-street-list input[type=checkbox]:not(:checked)",
      );
      await tapElement(box);
      await wait(800);
    },
  },
  "open-route-menu": {
    base: () => 0,
    done: () => Boolean(document.querySelector(".route-map-menu.is-open")),
    run: async () => {
      if (document.querySelector(".route-map-menu.is-open")) return;
      await tapElement(document.querySelector('[data-tour="route-toggle"]'));
    },
  },
  "place-start": {
    base: pointsKey,
    done: (b) => pointsKey() !== b,
    run: async () => {
      const map = tourBridge.map;
      const line = clusterLine();
      if (!map || !line) return;
      await tapElement(document.querySelector('[data-tour="route-point"]'));
      const [lng, lat] = line[0]!;
      const p = map.project([lng, lat]);
      const box = map.getCanvas().getBoundingClientRect();
      await tap(box.left + p.x, box.top + p.y);
      tourBridge.routeApi?.addStartPoint(lat, lng);
      await wait(900);
    },
  },
  "draw-route": {
    base: drawsKey,
    done: (b) => drawsKey() !== b,
    run: async () => {
      const map = tourBridge.map;
      const line = clusterLine();
      if (!map || !line || line.length < 2) return;
      await tapElement(document.querySelector('[data-tour="route-draw"]'));
      const box = map.getCanvas().getBoundingClientRect();
      const n = Math.min(4, line.length);
      const pts = Array.from({ length: n }, (_, i) => line[Math.round((i * (line.length - 1)) / (n - 1))]!);
      for (const [lng, lat] of pts) {
        const p = map.project([lng, lat]);
        await tap(box.left + p.x, box.top + p.y);
        tourBridge.routeApi?.stretchPoint(lng, lat);
        await wait(250);
      }
      tourBridge.routeApi?.finishStretch();
      // Leave drawing mode.
      const draw = document.querySelector<HTMLElement>('[data-tour="route-draw"][aria-pressed="true"]');
      draw?.click();
      await wait(800);
    },
  },
  "add-stage": {
    base: () => stages().length,
    done: (b) => stages().length > Number(b),
    run: async () => {
      await tapElement(document.querySelector('[data-tour="route-stage"]'));
      await wait(800);
    },
  },
};

async function undoAll(undo: Undo) {
  hideCursor();
  // Let the route planner finish saving what the tour did.
  await wait(900);
  for (const [ashkol, stagesBefore] of undo.routes) {
    await fetch(`/api/clusters/${encodeURIComponent(ashkol)}/route`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stages: stagesBefore }),
    }).catch(() => {});
  }
  for (const [id, wasDone] of undo.marks) {
    const box = document.querySelector<HTMLInputElement>(
      `.cluster-street-list input[data-street-id="${CSS.escape(id)}"]`,
    );
    if (box && box.checked === wasDone) continue;
    await fetch(`/api/streets/${encodeURIComponent(id)}/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: wasDone }),
    }).catch(() => {});
  }
  if (undo.menuWasOpen === false && document.querySelector(".route-map-menu.is-open")) {
    document.querySelector<HTMLElement>('[data-tour="route-toggle"]')?.click();
  }
  const select = document.querySelector<HTMLSelectElement>('[data-tour="cluster-select"] select');
  if (select && undo.ashkol !== undefined && select.value !== undo.ashkol) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, undo.ashkol);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  tourBridge.reloadRoute?.();
  tourBridge.refreshStreets?.();
  cursorEl?.remove();
  cursorEl = null;
}

/* ------------------------------------------------------------------ */
/* The tour                                                            */
/* ------------------------------------------------------------------ */

/**
 * Run a guide as a driver.js tour, in Hebrew and RTL.
 * Steps with a `task` wait for the user to do it, or do it for them with a visible cursor.
 * Everything the tour changed (street marks, route, open menu, selected cluster) is undone at the end.
 */
export function runTour(guide: Guide, onDone?: () => void): Driver {
  const steps = guide.steps;
  const hasTasks = steps.some((s) => s.task);
  const undo: Undo = {
    ashkol: tourBridge.selectedAshkol ?? "",
    routes: new Map(),
    marks: new Map(),
    menuWasOpen: Boolean(document.querySelector(".route-map-menu.is-open")),
  };
  let poll: number | null = null;
  let busy = false;

  const stopPoll = () => {
    if (poll != null) window.clearInterval(poll);
    poll = null;
  };

  async function prepare(step: TourStep) {
    if (!step.task) return;
    snapshotMarks(undo);
    if (step.task === "place-start" || step.task === "draw-route" || step.task === "add-stage") {
      await snapshotRoute(undo);
    }
  }

  const tour = driver({
    showProgress: steps.length > 1,
    progressText: "{{current}} מתוך {{total}}",
    nextBtnText: "הבא ←",
    prevBtnText: "→ הקודם",
    doneBtnText: "סיימתי 💪",
    allowClose: true,
    overlayOpacity: 0.5,
    stagePadding: 6,
    stageRadius: 10,
    popoverClass: "app-tour",
    steps: steps.map(
      (s): DriveStep => ({
        // Resolved when the step shows: a missing element becomes a centered card.
        element: s.element ? (() => visible(s.element!) as Element) : undefined,
        popover: { title: s.title, description: s.body.replace(/\n/g, "<br>") },
      }),
    ),
    onPopoverRender: (popover, { state }) => {
      stopPoll();
      const i = state.activeIndex ?? 0;
      const step = steps[i];
      if (!step?.task) return;
      const task = TASKS[step.task];
      void prepare(step);
      const base = task.base();

      const status = document.createElement("div");
      status.className = "tour-task-status";
      popover.description.after(status);

      const doIt = document.createElement("button");
      doIt.type = "button";
      doIt.className = "tour-do-it";
      doIt.textContent = "🤖 עשו את זה בשבילי";
      popover.footerButtons.prepend(doIt);

      const markDone = () => {
        status.textContent = "✓ מעולה! אפשר להמשיך";
        status.classList.add("is-done");
        doIt.disabled = true;
        doIt.textContent = "✓ בוצע";
      };
      if (task.done(base)) markDone();

      doIt.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        doIt.disabled = true;
        doIt.textContent = "רגע, אני עושה…";
        try {
          await prepare(step);
          await task.run();
        } finally {
          busy = false;
          hideCursor();
          if (task.done(base)) markDone();
          else {
            doIt.disabled = false;
            doIt.textContent = "🤖 עשו את זה בשבילי";
          }
          tour.refresh();
        }
      });

      // Notice when the user did it themselves.
      poll = window.setInterval(() => {
        if (!busy && task.done(base) && !status.classList.contains("is-done")) markDone();
      }, 500);
    },
    onNextClick: async () => {
      stopPoll();
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
    onDestroyed: () => {
      stopPoll();
      if (hasTasks) void undoAll(undo);
      onDone?.();
    },
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
