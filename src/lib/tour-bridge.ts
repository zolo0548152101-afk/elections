/**
 * Live handles the guided tour uses to act on the map and route planner
 * ("do it for me") and to undo what the tour did when it ends.
 * Set by StreetMap and RoutePlanner while they are mounted.
 */
import type { Map as MapLibreMap } from "maplibre-gl";
import type { RouteApi } from "@/components/RoutePlanner";
import type { RouteStage } from "@/lib/cluster-route-types";

export const tourBridge: {
  map?: MapLibreMap;
  routeApi?: RouteApi | null;
  selectedAshkol?: string;
  getStages?: () => RouteStage[];
  /** Reload the route of the selected cluster from the server. */
  reloadRoute?: () => void;
  /** Reload the street list and street marks. */
  refreshStreets?: () => void;
  /** A cluster worth showing in the tour: one with the most linked streets. */
  tourAshkol?: () => string | undefined;
} = {};

// Local development only: lets browser tests reach the map.
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as unknown as { __tourBridge?: typeof tourBridge }).__tourBridge = tourBridge;
}
