/**
 * Mapbox Standard light presets — driven by Islamabad local clock
 * (Asia/Karachi, UTC+5, no DST).
 */
export type MapLightPreset = "day" | "dusk" | "night" | "dawn";

export function lightPresetForIslamabad(now = new Date()): MapLightPreset {
  const hourStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  const hour = Number.parseInt(hourStr, 10);
  if (!Number.isFinite(hour)) return "dusk";
  // Skip Mapbox "day" — too bright for this HUD. Soft dawn → dusk → night.
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 20) return "dusk";
  return "night";
}

export function applyMapLightPreset(
  map: { setConfigProperty: (c: string, k: string, v: unknown) => void },
  preset: MapLightPreset
) {
  try {
    map.setConfigProperty("basemap", "lightPreset", preset);
  } catch {
    /* older style / not ready */
  }
}
