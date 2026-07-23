export type PresencePeer = {
  id: string;
  lat?: number;
  lng?: number;
};

export type PresenceSnapshot = {
  viewers: number;
  peers: PresencePeer[];
};

export type CameraPose = {
  lat: number;
  lng: number;
};
