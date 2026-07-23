import { MercatorCoordinate, type Map as MapboxMap } from "mapbox-gl";
import {
  LAUNCH_CAMERA_TRACK,
  type LaunchKeyframe,
} from "@/lib/launchCameraTrack";

/** Try to read the visitor's current position; resolves null on denial/timeout */
export function getUserLocation(
  timeoutMs: number
): Promise<{ lat: number; lng: number } | null> {
  if (typeof window === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { lat: number; lng: number } | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        finish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        window.clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 5 * 60 * 1000 }
    );
  });
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** Sample the baked track at normalized time `u` (0→1). */
function sampleBakedTrack(u: number): LaunchKeyframe {
  const track = LAUNCH_CAMERA_TRACK;
  const first = track[0];
  const last = track[track.length - 1];
  if (u <= first.t) return first;
  if (u >= last.t) return last;

  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (u >= a.t && u <= b.t) {
      const span = b.t - a.t || 1;
      const local = (u - a.t) / span;
      return {
        t: u,
        lng: lerp(a.lng, b.lng, local),
        lat: lerp(a.lat, b.lat, local),
        zoom: lerp(a.zoom, b.zoom, local),
        pitch: lerp(a.pitch, b.pitch, local),
        bearing: lerp(a.bearing, b.bearing, local),
        eyeLng: lerp(a.eyeLng, b.eyeLng, local),
        eyeLat: lerp(a.eyeLat, b.eyeLat, local),
        altitude: lerp(a.altitude, b.altitude, local),
      };
    }
  }

  return last;
}

/** Apply a baked free-camera eye pose (no DEM resampling). */
function applyBakedPose(map: MapboxMap, view: LaunchKeyframe) {
  const camera = map.getFreeCameraOptions();
  camera.position = MercatorCoordinate.fromLngLat(
    { lng: view.eyeLng, lat: view.eyeLat },
    view.altitude
  );
  camera.setPitchBearing(view.pitch, view.bearing);
  map.setFreeCameraOptions(camera);
}

/** Park on the opening baked frame so the first visible frame isn't mid-load. */
export function parkLaunchCameraOpening(map: MapboxMap) {
  const first = LAUNCH_CAMERA_TRACK[0];
  map.jumpTo({
    center: [first.lng, first.lat],
    zoom: first.zoom,
    pitch: first.pitch,
    bearing: first.bearing,
  });
  applyBakedPose(map, first);
}

/**
 * Play the pre-baked free-camera track. Poses were recorded with terrain off;
 * playback keeps terrain on for mountains but never re-queries DEM for the eye.
 */
export function animateLaunchCamera(
  map: MapboxMap,
  durationMs: number,
  onComplete?: () => void
): () => void {
  let raf = 0;
  const first = LAUNCH_CAMERA_TRACK[0];
  const last = LAUNCH_CAMERA_TRACK[LAUNCH_CAMERA_TRACK.length - 1];

  applyBakedPose(map, first);

  const startedAt = performance.now();

  const frame = (now: number) => {
    const u = Math.min(1, (now - startedAt) / durationMs);
    applyBakedPose(map, sampleBakedTrack(u));

    if (u < 1) {
      raf = requestAnimationFrame(frame);
    } else {
      // Hand back to the normal camera API for gestures / UI.
      map.jumpTo({
        center: [last.lng, last.lat],
        zoom: last.zoom,
        pitch: last.pitch,
        bearing: last.bearing,
      });
      onComplete?.();
    }
  };

  raf = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(raf);
}
