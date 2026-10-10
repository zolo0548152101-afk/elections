declare module "vt-pbf" {
  import type { Tile } from "geojson-vt";
  const vtpbf: {
    fromGeojsonVt: (
      layers: Record<string, Tile>,
      options?: { version?: number },
    ) => Uint8Array;
  };
  export default vtpbf;
}
