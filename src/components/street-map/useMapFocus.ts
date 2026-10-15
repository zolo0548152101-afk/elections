"use client";

import { useEffect, type RefObject } from "react";

/** Where the page should scroll so `el` sits in the middle of the screen (or its top, if taller). */
function centeredTop(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const gap = Math.max(8, (window.innerHeight - r.height) / 2);
  return window.scrollY + r.top - gap;
}

/**
 * Once the user clicks on the map, bring it to the middle of the screen and keep it there
 * while cards above it (cluster, streets) open and close. Released when the user scrolls
 * the page themselves or clicks outside the map.
 */
export function useMapFocus(stageRef: RefObject<HTMLElement | null>, wrapRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const stage = stageRef.current;
    const wrap = wrapRef.current;
    if (!stage || !wrap) return;

    let anchored = false;
    let anchorTop = 0; // the stage's distance from the top of the screen to hold
    let selfScroll = 0; // ignore scroll events we caused

    const scrollTo = (top: number, smooth: boolean) => {
      selfScroll = performance.now();
      window.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
    };

    const onDown = (e: PointerEvent) => {
      const inside = stage.contains(e.target as Node);
      if (!inside) {
        anchored = false;
        return;
      }
      if (document.fullscreenElement || stage.classList.contains("is-full")) return;
      const target = centeredTop(stage);
      anchored = true;
      // Hold the map where it will be after centering.
      anchorTop = stage.getBoundingClientRect().top - (target - window.scrollY);
      if (Math.abs(target - window.scrollY) > 24) scrollTo(target, true);
    };

    // Cards above the map changed height: shift the page by the same amount.
    const ro = new ResizeObserver(() => {
      if (!anchored) return;
      const drift = stage.getBoundingClientRect().top - anchorTop;
      if (Math.abs(drift) > 1) scrollTo(window.scrollY + drift, false);
    });
    ro.observe(wrap);

    // The user scrolled the page on their own: let go.
    const release = () => {
      if (performance.now() - selfScroll < 900) return;
      anchored = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (!stage.contains(e.target as Node)) release();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!stage.contains(e.target as Node)) release();
    };
    const onKey = (e: KeyboardEvent) => {
      if (["PageDown", "PageUp", "Home", "End", "ArrowDown", "ArrowUp", " "].includes(e.key)) release();
    };

    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      ro.disconnect();
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("keydown", onKey);
    };
  }, [stageRef, wrapRef]);
}

/**
 * Close a box when the user clicks anywhere outside it (a real click, not a map drag).
 */
export function useCloseOnOutsideClick(
  boxRef: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    let start: { x: number; y: number; outside: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      const box = boxRef.current;
      start = { x: e.clientX, y: e.clientY, outside: !box || !box.contains(e.target as Node) };
    };
    const onUp = (e: PointerEvent) => {
      if (!start) return;
      const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6;
      if (start.outside && !moved) onClose();
      start = null;
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("pointerup", onUp, true);
    };
  }, [boxRef, open, onClose]);
}
