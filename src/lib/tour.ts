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

/** Scroll the page so that `el` sits in the middle of the screen (the screen follows the cursor). */
async function centerOnScreen(el: Element) {
  el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  await wait(550);
}

async function tapElement(el: HTMLElement | null) {
  if (!el) return;
  await centerOnScreen(el);
  const r = el.getBoundingClientRect();
  await tap(r.left + r.width / 2, r.top + r.height / 2);
  el.click();
  await wait(300);
}

/**
 * Tap a spot on the map with the cursor kept in the middle of the screen:
 * the page centers the map, and the map pans so the spot comes to its middle.
 */
async function tapMap(lng: number, lat: number, zoom?: number) {
  const map = tourBridge.map;
  if (!map) return;
  await centerOnScreen(map.getContainer());
  map.easeTo({ center: [lng, lat], zoom: zoom ?? map.getZoom(), duration: 500 });
  await wait(560);
  const p = map.project([lng, lat]);
  const box = map.getCanvas().getBoundingClientRect();
  await tap(box.left + p.x, box.top + p.y);
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
  /** Map view before the tour (the cursor pans the map). */
  camera?: { center: [number, number]; zoom: number; bearing: number; pitch: number };
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
      await tapMap(lng, lat, Math.max(map.getZoom(), 16));
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
      const n = Math.min(4, line.length);
      const pts = Array.from({ length: n }, (_, i) => line[Math.round((i * (line.length - 1)) / (n - 1))]!);
      const zoom = Math.max(map.getZoom(), 16);
      for (const [lng, lat] of pts) {
        await tapMap(lng, lat, zoom);
        tourBridge.routeApi?.stretchPoint(lng, lat);
        await wait(200);
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
  // Street marks and routes go back together (in parallel), so leaving the page right away still undoes them.
  const jobs: Promise<unknown>[] = [];
  for (const [id, wasDone] of undo.marks) {
    const box = document.querySelector<HTMLInputElement>(
      `.cluster-street-list input[data-street-id="${CSS.escape(id)}"]`,
    );
    if (box && box.checked === wasDone) continue;
    jobs.push(
      fetch(`/api/streets/${encodeURIComponent(id)}/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: wasDone }),
        keepalive: true,
      }).catch(() => {}),
    );
  }
  for (const [ashkol, stagesBefore] of undo.routes) {
    jobs.push(
      fetch(`/api/clusters/${encodeURIComponent(ashkol)}/route`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: stagesBefore }),
        keepalive: true,
      }).catch(() => {}),
    );
  }
  await Promise.all(jobs);
  if (undo.menuWasOpen === false && document.querySelector(".route-map-menu.is-open")) {
    document.querySelector<HTMLElement>('[data-tour="route-toggle"]')?.click();
  }
  const select = document.querySelector<HTMLSelectElement>('[data-tour="cluster-select"] select');
  if (select && undo.ashkol !== undefined && select.value !== undo.ashkol) {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
    setter.call(select, undo.ashkol);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (undo.camera && tourBridge.map) tourBridge.map.easeTo({ ...undo.camera, duration: 600 });
  tourBridge.reloadRoute?.();
  tourBridge.refreshStreets?.();
  cursorEl?.remove();
  cursorEl = null;
}


/* ------------------------------------------------------------------ */
/* Keep the tour card off the spot the user is working on              */
/* ------------------------------------------------------------------ */

type Box = { left: number; top: number; right: number; bottom: number };

function boxOf(selector: string): Box | null {
  const el = visible(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  // Only the part on screen matters.
  const box = {
    left: Math.max(0, r.left),
    top: Math.max(0, r.top),
    right: Math.min(window.innerWidth, r.right),
    bottom: Math.min(window.innerHeight, r.bottom),
  };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

/** Screen box around the selected cluster's streets (where the user clicks to place points and draw). */
function clusterStreetsBox(): Box | null {
  const map = tourBridge.map;
  const a = tourBridge.selectedAshkol;
  if (!map || !a || !map.getSource("eshkol-streets")) return null;
  const canvas = map.getCanvas().getBoundingClientRect();
  let box: Box | null = null;
  for (const f of map.querySourceFeatures("eshkol-streets")) {
    if (f.properties?.ashkol !== a) continue;
    const g = f.geometry;
    const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
    for (const line of lines) {
      for (const [lng, lat] of line as [number, number][]) {
        const p = map.project([lng, lat]);
        const x = canvas.left + p.x;
        const y = canvas.top + p.y;
        box = box
          ? { left: Math.min(box.left, x), top: Math.min(box.top, y), right: Math.max(box.right, x), bottom: Math.max(box.bottom, y) }
          : { left: x, top: y, right: x, bottom: y };
      }
    }
  }
  if (!box) return null;
  const pad = 36;
  return {
    left: Math.max(canvas.left, box.left - pad),
    top: Math.max(canvas.top, box.top - pad),
    right: Math.min(canvas.right, box.right + pad),
    bottom: Math.min(canvas.bottom, box.bottom + pad),
  };
}

const MENU = '[data-tour="route-menu"]';

/** Where the user's hands are during each task. The card must not cover these. */
const WORK_AREA: Record<TaskId, () => (Box | null)[]> = {
  "select-cluster": () => [boxOf('[data-tour="cluster-select"]')],
  "mark-street": () => [boxOf('[data-tour="street-card"]')],
  "open-route-menu": () => [boxOf('[data-tour="route-toggle"]'), boxOf(".route-map-menu.is-open")],
  "place-start": () => [clusterStreetsBox(), boxOf(MENU)],
  "draw-route": () => [clusterStreetsBox(), boxOf(MENU)],
  "add-stage": () => [boxOf('[data-tour="route-stage"]'), boxOf(MENU)],
};

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * If the card covers the work area, dock it to the screen spot that covers it least
 * (a corner or an edge).
 */
function keepClear(card: HTMLElement, task: TaskId) {
  const avoid = WORK_AREA[task]().filter((b): b is Box => Boolean(b));
  if (avoid.length === 0) return;
  const covered = (b: Box) => avoid.reduce((sum, a) => sum + overlapArea(a, b), 0);
  const now = card.getBoundingClientRect();
  if (covered(now) === 0) return;

  const place = () => {
    const r = card.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    const m = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const xs = [m, (vw - w) / 2, vw - w - m];
    const ys = [m + 56, (vh - h) / 2, vh - h - m];
    let best: { x: number; y: number; score: number } | null = null;
    for (const x of xs) {
      for (const y of ys) {
        const b = { left: x, top: y, right: x + w, bottom: y + h };
        const score = covered(b) * 1000 + Math.hypot(x - now.left, y - now.top);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    card.style.setProperty("--dock-x", `${Math.max(m, best!.x)}px`);
    card.style.setProperty("--dock-y", `${Math.max(m, best!.y)}px`);
    card.classList.add("is-docked");
  };

  place();
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
  const map = tourBridge.map;
  if (map) {
    const c = map.getCenter();
    undo.camera = { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  }
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

  /* While the user works, the card and the dark overlay step aside; a small bar stays. */
  let pill: HTMLDivElement | null = null;

  function placePill(task: TaskId) {
    if (!pill) return;
    const avoid = WORK_AREA[task]().filter((b): b is Box => Boolean(b));
    const r = pill.getBoundingClientRect();
    const h = r.height;
    const vh = window.innerHeight;
    const bottom = { left: r.left, right: r.right, top: vh - h - 16, bottom: vh - 16 };
    const clash = avoid.some((a) => overlapArea(a, bottom) > 0);
    pill.classList.toggle("at-top", clash);
  }

  function enterHandsOn(task: TaskId, text: string, forMe: (() => void) | null) {
    leaveHandsOn();
    document.body.classList.add("tour-hands-on");
    document.body.classList.remove("driver-active");
    pill = document.createElement("div");
    pill.className = "tour-pill";
    pill.dir = "rtl";
    pill.setAttribute("role", "status");
    const label = document.createElement("span");
    label.className = "tour-pill-text";
    label.textContent = text;
    pill.append(label);
    if (forMe) {
      const me = document.createElement("button");
      me.type = "button";
      me.textContent = "🤖 עשו בשבילי";
      me.addEventListener("click", forMe);
      const back = document.createElement("button");
      back.type = "button";
      back.className = "tour-pill-back";
      back.textContent = "📖 המדריך";
      back.title = "חזרה להסבר ולהמשך המדריך";
      back.addEventListener("click", () => {
        leaveHandsOn();
        tour.refresh();
      });
      pill.append(me, back);
    }
    document.body.append(pill);
    placePill(task);
  }

  function leaveHandsOn() {
    pill?.remove();
    pill = null;
    if (document.body.classList.contains("tour-hands-on")) {
      document.body.classList.remove("tour-hands-on");
      if (tourRef?.isActive()) document.body.classList.add("driver-active");
    }
  }

  let tourRef: Driver | null = null;

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
      leaveHandsOn();
      const i = state.activeIndex ?? 0;
      const step = steps[i];
      popover.wrapper.classList.remove("is-docked");
      if (!step?.task) return;
      const taskId = step.task;
      const task = TASKS[taskId];
      void prepare(step);
      const base = task.base();
      const doLine = (step.body.split("\n").find((l) => l.startsWith("👉")) ?? "👉 תורכם!")
        .replace(/^👉\s*תורכם:\s*/, "👉 ");

      const status = document.createElement("div");
      status.className = "tour-task-status";
      popover.description.after(status);

      // "I'll do it" hides the card; a small bar stays with the instruction.
      const mine = document.createElement("button");
      mine.type = "button";
      mine.className = "tour-mine";
      mine.textContent = "👉 יאללה, אני עושה";
      const doIt = document.createElement("button");
      doIt.type = "button";
      doIt.className = "tour-do-it";
      doIt.textContent = "🤖 עשו בשבילי";
      const actions = document.createElement("div");
      actions.className = "tour-task-actions";
      actions.append(mine, doIt);
      status.after(actions);

      let finished = false;
      const markDone = () => {
        finished = true;
        status.textContent = "✓ מעולה! אפשר להמשיך";
        status.classList.add("is-done");
        actions.hidden = true;
      };
      if (task.done(base)) markDone();

      const runForMe = async () => {
        if (busy || finished) return;
        busy = true;
        enterHandsOn(taskId, "🤖 רגע, אני עושה את זה בשבילכם…", null);
        try {
          await prepare(step);
          await task.run();
        } finally {
          busy = false;
          hideCursor();
          await wait(500);
          if (task.done(base)) markDone();
          leaveHandsOn();
          tour.refresh();
        }
      };

      mine.addEventListener("click", () => enterHandsOn(taskId, doLine, runForMe));
      doIt.addEventListener("click", () => void runForMe());

      // driver.js places the card first; then move it off the work area if needed.
      const card = popover.wrapper;
      requestAnimationFrame(() => requestAnimationFrame(() => keepClear(card, taskId)));

      // Notice when the user did it themselves: the bar goes away and the card comes back with ✓.
      poll = window.setInterval(() => {
        if (!busy && !finished && task.done(base)) {
          markDone();
          window.setTimeout(() => {
            leaveHandsOn();
            tour.refresh();
          }, 700);
        }
        if (pill) placePill(taskId);
        else keepClear(card, taskId);
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
      leaveHandsOn();
      if (hasTasks) void undoAll(undo);
      onDone?.();
    },
  });
  tourRef = tour;
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
