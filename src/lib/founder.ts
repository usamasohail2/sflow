/** Founder / owner — special map avatar + ★ by name */
export const FOUNDER_EMAIL = "xalion.malik@gmail.com";

/** Presence/chat color marker (not a normal palette index) */
export const FOUNDER_COLOR = 100;

export const FOUNDER_PALETTE = {
  shirt: "#C9A227",
  skin: "#f0c4a0",
  hair: "#1a1208",
  accent: "#FFE566",
} as const;

export function isFounderEmail(email?: string | null): boolean {
  return email?.trim().toLowerCase() === FOUNDER_EMAIL;
}

export function isFounderColor(color?: number | null): boolean {
  return color === FOUNDER_COLOR;
}
