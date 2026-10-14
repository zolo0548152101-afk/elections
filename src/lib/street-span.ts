import type { RouteGeometry } from "@/lib/cluster-route-types";

function lerp(a: number[], b: number[], t: number): number[] {
  return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
}

function dist(a: number[], b: number[]) {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
}

function metersBetween(a: number[], b: number[]) {
  const lat = (((a[1]! + b[1]!) / 2) * Math.PI) / 180;
  const east = (b[0]! - a[0]!) * 111320 * Math.cos(lat);
  const north = (b[1]! - a[1]!) * 110540;
  return Math.hypot(east, north);
}

/** Length of a street line in meters. */
export function lineLengthMeters(coordinates: number[][]) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += metersBetween(coordinates[i - 1]!, coordinates[i]!);
  }
  return total;
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

export type ArrowMark = { lng: number; lat: number; bearing: number };

/** Clockwise degrees from north for the step from a to b. */
function bearingOf(a: number[], b: number[]) {
  const rad = Math.atan2(b[0]! - a[0]!, b[1]! - a[1]!);
  const deg = (rad * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Meters under 1 km, then kilometers, for the on-map length pill. */
export function formatLengthPill(meters: number) {
  if (!Number.isFinite(meters) || meters <= 0) return "0 מ׳";
  if (meters < 1000) return `${Math.round(meters).toLocaleString("he-IL")} מ׳`;
  return `${(meters / 1000).toFixed(2)} ק״מ`;
}

/** Exact meters for the route menu. */
export function formatMeters(meters: number) {
  const n = Number.isFinite(meters) && meters > 0 ? Math.round(meters) : 0;
  return `${n.toLocaleString("he-IL")} מ׳`;
}

/**
 * Fixed arrows along a stretched line, about every `spacingMeters`.
 * Bearing follows the line order and does not wrap back to the start.
 */
export function arrowMarksEvery(
  coordinates: number[][],
  spacingMeters = 40,
): ArrowMark[] {
  if (coordinates.length < 2) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const length = metersBetween(coordinates[i - 1]!, coordinates[i]!);
    lengths.push(length);
    total += length;
  }
  if (total < 8) return [];
  const spacing = spacingMeters > 1 ? spacingMeters : 40;
  const targets: number[] = [];
  // The first arrow sits near the start so a new route shows its direction at once.
  targets.push(Math.min(15, total / 2));
  if (total >= spacing) {
    for (let walked = spacing; walked < total - 4; walked += spacing) targets.push(walked);
  }
  const marks: ArrowMark[] = [];
  for (const distAlong of targets) {
    let walked = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const seg = lengths[i - 1]!;
      const next = walked + seg;
      if (next + 1e-6 < distAlong && i < coordinates.length - 1) {
        walked = next;
        continue;
      }
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (distAlong - walked) / seg));
      const a = coordinates[i - 1]!;
      const b = coordinates[i]!;
      const point = lerp(a, b, t);
      marks.push({ lng: point[0]!, lat: point[1]!, bearing: bearingOf(a, b) });
      break;
    }
  }
  return marks;
}

/** Where a dragged leg should gain a handle. `index` is the vertex before the insert. */
export function closestInsert(coordinates: number[][], lng: number, lat: number) {
  if (coordinates.length < 2) return null;
  let best = Infinity;
  let bestIndex = 0;
  let bestT = 0;
  let bestLng = coordinates[0]![0]!;
  let bestLat = coordinates[0]![1]!;
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const midLat = ((a[1]! + b[1]!) / 2) * (Math.PI / 180);
    const scale = 111320 * Math.cos(midLat);
    const abE = (b[0]! - a[0]!) * scale;
    const abN = (b[1]! - a[1]!) * 110540;
    const apE = (lng - a[0]!) * scale;
    const apN = (lat - a[1]!) * 110540;
    const len2 = abE * abE + abN * abN;
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, (apE * abE + apN * abN) / len2));
    const dist = Math.hypot(apE - abE * t, apN - abN * t);
    if (dist < best) {
      best = dist;
      bestIndex = i - 1;
      bestT = t;
      bestLng = a[0]! + (b[0]! - a[0]!) * t;
      bestLat = a[1]! + (b[1]! - a[1]!) * t;
    }
  }
  return { index: bestIndex, t: bestT, lng: bestLng, lat: bestLat };
}

/**
 * A few arrow positions along a directed line.
 * `phase` is 0–1 and slides them forward. Bearing 0 is north.
 */
export function arrowMarks(
  coordinates: number[][],
  phase: number,
  count = 3,
): ArrowMark[] {
  if (coordinates.length < 2) return [];
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const length = dist(coordinates[i - 1]!, coordinates[i]!);
    lengths.push(length);
    total += length;
  }
  if (total === 0) return [];
  const n = count < 1 ? 1 : count;
  const shift = ((phase % 1) + 1) % 1;
  const marks: ArrowMark[] = [];
  for (let k = 0; k < n; k++) {
    const distAlong = ((shift + k / n) % 1) * total;
    let walked = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const seg = lengths[i - 1]!;
      const next = walked + seg;
      if (next + 1e-9 < distAlong && i < coordinates.length - 1) {
        walked = next;
        continue;
      }
      const t = seg === 0 ? 0 : Math.min(1, Math.max(0, (distAlong - walked) / seg));
      const a = coordinates[i - 1]!;
      const b = coordinates[i]!;
      const point = lerp(a, b, t);
      marks.push({ lng: point[0]!, lat: point[1]!, bearing: bearingOf(a, b) });
      break;
    }
  }
  return marks;
}

/** Walk the same portion from the other end. */
export function directedGeometry(
  geometry: RouteGeometry | null,
  reversed: boolean,
): RouteGeometry | null {
  if (!geometry || !reversed) return geometry;
  if (geometry.type === "LineString") {
    return { type: "LineString", coordinates: [...geometry.coordinates].reverse() };
  }
  return {
    type: "MultiLineString",
    coordinates: [...geometry.coordinates]
      .reverse()
      .map((line) => [...line].reverse()),
  };
}
