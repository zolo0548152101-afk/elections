import type { RouteGeometry } from "@/lib/cluster-route-types";

function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
}

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

export function clampRatio(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

/** Keep the portion of a street between two ratios along its length. */
export function spanOf(
  geometry: RouteGeometry | null,
  from: number,
  to: number,
): RouteGeometry | null {
  if (!geometry) return null;
  const lines =
    geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
  const coords: number[][] = [];
  for (const line of lines) {
    for (const point of line) {
      const prev = coords[coords.length - 1];
      if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
      coords.push(point);
    }
  }
  if (coords.length < 2) return null;
  const start = Math.min(clampRatio(from, 0), clampRatio(to, 1));
  const end = Math.max(clampRatio(from, 0), clampRatio(to, 1));
  if (start <= 0 && end >= 1) return { type: "LineString", coordinates: coords };

  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const length = dist(coords[i - 1]!, coords[i]!);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return { type: "LineString", coordinates: coords.slice(0, 2) };

  const fromD = start * total;
  const toD = end * total;
  const out: number[][] = [];
  let walked = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = lengths[i - 1]!;
    const next = walked + seg;
    if (next < fromD) {
      walked = next;
      continue;
    }
    if (out.length === 0) {
      const t = seg === 0 ? 0 : (fromD - walked) / seg;
      out.push(lerp(coords[i - 1]!, coords[i]!, Math.min(1, Math.max(0, t))));
    }
    if (next <= toD + 1e-9) {
      out.push(coords[i]!);
    } else {
      const t = seg === 0 ? 1 : (toD - walked) / seg;
      out.push(lerp(coords[i - 1]!, coords[i]!, Math.min(1, Math.max(0, t))));
      break;
    }
    if (walked >= toD) break;
    walked = next;
  }
  return out.length >= 2 ? { type: "LineString", coordinates: out } : null;
}
