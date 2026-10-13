/** Bump when street geometry changes so cached tiles are discarded. */
export const STREETS_TILE_VERSION = "1";

export function streetsTilePath() {
  return `/api/tiles/{z}/{x}/{y}?v=${STREETS_TILE_VERSION}`;
}
