import type { Sector } from "@/lib/gameTypes";
import { closeRing } from "@/lib/geo";

/** Temporary: skip Google auth and use a local guest player. */
export const AUTH_DISABLED = true;

export const GUEST_PLAYER_ID = "guest-dev";

/**
 * Two small test territories near central Islamabad so game logic
 * can be exercised without drawing first.
 */
export function buildDummySectors(now = Date.now()): Sector[] {
  // Rough boxes west of Zero Point / Blue Area corridor
  const alpha: [number, number][] = [
    [73.05, 33.72],
    [73.07, 33.72],
    [73.07, 33.735],
    [73.05, 33.735],
  ];
  const bravo: [number, number][] = [
    [73.02, 33.69],
    [73.04, 33.69],
    [73.04, 33.705],
    [73.02, 33.705],
  ];

  return [
    {
      id: "sec_dummy_alpha",
      name: "Dummy Alpha",
      ring: closeRing(alpha),
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "sec_dummy_bravo",
      name: "Dummy Bravo",
      ring: closeRing(bravo),
      createdAt: now,
      updatedAt: now,
    },
  ];
}
