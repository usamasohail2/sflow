import sectors from "@/data/islamabad-sectors.json";
import type { SectorFeatureCollection } from "@/lib/sectorTypes";

export type { SectorProperties } from "@/lib/sectorTypes";

export const islamabadSectors = sectors as SectorFeatureCollection;

/** Boundary rings as LineStrings — one wall path per sector. */
export function sectorWallsCollection() {
  return {
    type: "FeatureCollection" as const,
    features: islamabadSectors.features.map((f) => ({
      type: "Feature" as const,
      properties: { ...f.properties },
      geometry: {
        type: "LineString" as const,
        coordinates: f.geometry.coordinates[0],
      },
    })),
  };
}

export const SECTOR_CENTER = {
  lng: 73.04,
  lat: 33.7,
  zoom: 11.35,
} as const;
