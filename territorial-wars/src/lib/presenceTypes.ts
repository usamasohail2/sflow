export type PresencePeer = {
  id: string;
  name?: string;
  lat?: number;
  lng?: number;
  /** Latest public chat line (short-lived bubble above the marker) */
  lastMessage?: string;
  lastMessageAt?: number;
};

export type PresenceSnapshot = {
  viewers: number;
  peers: PresencePeer[];
};

export type CameraPose = {
  lat: number;
  lng: number;
};

export type TouchPresenceInput = {
  camera?: CameraPose | null;
  name?: string | null;
  lastMessage?: string | null;
  lastMessageAt?: number | null;
};

export type ChatMessage = {
  id: string;
  visitorId: string;
  name: string;
  text: string;
  t: number;
};
