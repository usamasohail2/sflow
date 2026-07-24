export type SectorProperties = {
  id: string;
  name: string;
  letter: string;
  number: number;
  row: number;
};

export type SectorFeature = {
  type: "Feature";
  properties: SectorProperties;
  geometry: {
    type: "Polygon";
    coordinates: number[][][];
  };
};

export type SectorFeatureCollection = {
  type: "FeatureCollection";
  features: SectorFeature[];
};
