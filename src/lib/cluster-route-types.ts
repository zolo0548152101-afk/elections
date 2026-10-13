export type RouteGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] };

export type RouteStreet = {
  street_id: string;
  name_he: string;
  note: string;
  from_ratio: number;
  to_ratio: number;
  reversed: boolean;
  done: boolean;
  geometry: RouteGeometry | null;
};

export type RoutePoint = {
  lat: number;
  lng: number;
  note: string;
};

/** A bold stretch line: handles in travel order. Not tied to a street geometry. */
export type RouteDraw = {
  coordinates: number[][];
  done: boolean;
};

export type RouteStage = {
  stage_no: number;
  streets: RouteStreet[];
  draws: RouteDraw[];
  point: RoutePoint | null;
};

export type RoutePayload = {
  stages: RouteStage[];
};
