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

export type RouteStage = {
  stage_no: number;
  streets: RouteStreet[];
  point: RoutePoint | null;
};

export type RoutePayload = {
  stages: RouteStage[];
};
