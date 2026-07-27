import type { LatLng } from "@/lib/gameTypes";

/** Ray-cast point-in-polygon. Ring is [lng, lat][], may be open or closed. */
export function pointInRing(point: LatLng, ring: [number, number][]): boolean {
  if (ring.length < 3) return false;
  const x = point.lng;
  const y = point.lat;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const denom = yj - yi;
    if (denom === 0) continue;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Approx meters between two lat/lng points */
function haversineMeters(a: LatLng, b: LatLng): number {
  const x =
    (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = (a.lat - b.lat) * 111_320;
  return Math.hypot(x, y);
}

/**
 * GPS-tolerant sector check: inside the ring, or within `slackM` of the boundary.
 */
export function pointInOrNearRing(
  point: LatLng,
  ring: [number, number][],
  slackM = 120
): boolean {
  if (pointInRing(point, ring)) return true;
  if (ring.length < 2) return false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i]!;
    const b = ring[i + 1]!;
    // Sample the edge (ends + midpoint) — good enough for GPS slack
    const samples: LatLng[] = [
      { lat: a[1], lng: a[0] },
      { lat: b[1], lng: b[0] },
      { lat: (a[1] + b[1]) / 2, lng: (a[0] + b[0]) / 2 },
    ];
    for (const s of samples) {
      if (haversineMeters(point, s) <= slackM) return true;
    }
  }
  return false;
}

export function closeRing(ring: [number, number][]): [number, number][] {
  if (ring.length === 0) return ring;
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

/** Drop near-duplicate vertices that break wall offsets / extrusions */
export function cleanRing(
  ring: [number, number][],
  minEdgeM = 3
): [number, number][] {
  if (ring.length === 0) return ring;
  const raw = closeRing(ring).slice(0, -1);
  const out: [number, number][] = [];
  for (const p of raw) {
    if (out.length === 0) {
      out.push([p[0], p[1]]);
      continue;
    }
    const prev = out[out.length - 1]!;
    if (
      haversineMeters(
        { lat: p[1], lng: p[0] },
        { lat: prev[1], lng: prev[0] }
      ) >= minEdgeM
    ) {
      out.push([p[0], p[1]]);
    }
  }
  if (out.length >= 3) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (
      haversineMeters(
        { lat: first[1], lng: first[0] },
        { lat: last[1], lng: last[0] }
      ) < minEdgeM
    ) {
      out.pop();
    }
  }
  return closeRing(out.length >= 3 ? out : raw.map((p) => [p[0], p[1]] as [number, number]));
}

/**
 * Shrink a ring toward its centroid by ~insetM meters.
 * Fallback only — prefer insetRing for concave sectors.
 */
export function shrinkRing(
  ring: [number, number][],
  insetM: number
): [number, number][] {
  const closed = cleanRing(ring);
  const pts = closed.slice(0, -1);
  if (pts.length < 3) return closed;

  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of pts) {
    lngSum += lng;
    latSum += lat;
  }
  const cLng = lngSum / pts.length;
  const cLat = latSum / pts.length;
  const cos = Math.cos((cLat * Math.PI) / 180);

  const shrunk = pts.map(([lng, lat]) => {
    const east = (lng - cLng) * 111_320 * cos;
    const north = (lat - cLat) * 111_320;
    const dist = Math.hypot(east, north) || 1;
    const factor = Math.max(0.08, (dist - insetM) / dist);
    return [
      cLng + (east * factor) / (111_320 * cos),
      cLat + (north * factor) / 111_320,
    ] as [number, number];
  });
  return closeRing(shrunk);
}

type XY = [number, number];

function ringToLocalXY(pts: [number, number][]): {
  xy: XY[];
  toLL: (p: XY) => [number, number];
} {
  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of pts) {
    lngSum += lng;
    latSum += lat;
  }
  const cLng = lngSum / pts.length;
  const cLat = latSum / pts.length;
  const cos = Math.max(0.2, Math.cos((cLat * Math.PI) / 180));
  const xy: XY[] = pts.map(([lng, lat]) => [
    (lng - cLng) * 111_320 * cos,
    (lat - cLat) * 111_320,
  ]);
  const toLL = ([x, y]: XY): [number, number] => [
    cLng + x / (111_320 * cos),
    cLat + y / 111_320,
  ];
  return { xy, toLL };
}

function signedAreaXY(xy: XY[]): number {
  let area = 0;
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]!;
    const [x2, y2] = xy[(i + 1) % xy.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/**
 * Inset vertices along edge normals with miter joins (meters).
 * Correct for concave rings — unlike centroid shrink.
 */
export function insetRing(
  ring: [number, number][],
  insetM: number
): [number, number][] {
  const closed = cleanRing(ring);
  const pts = closed.slice(0, -1);
  if (pts.length < 3 || insetM <= 0) return closed;

  const { xy, toLL } = ringToLocalXY(pts);
  const area = signedAreaXY(xy);
  if (Math.abs(area) < 1) return shrinkRing(ring, insetM);
  // CCW → interior left of edges; CW → interior right
  const ccw = area > 0;
  const n = xy.length;
  const out: XY[] = [];

  for (let i = 0; i < n; i++) {
    const prev = xy[(i - 1 + n) % n]!;
    const cur = xy[i]!;
    const next = xy[(i + 1) % n]!;

    const e1x = cur[0] - prev[0];
    const e1y = cur[1] - prev[1];
    const e2x = next[0] - cur[0];
    const e2y = next[1] - cur[1];
    const len1 = Math.hypot(e1x, e1y) || 1;
    const len2 = Math.hypot(e2x, e2y) || 1;
    const u1x = e1x / len1;
    const u1y = e1y / len1;
    const u2x = e2x / len2;
    const u2y = e2y / len2;

    const n1x = ccw ? -u1y : u1y;
    const n1y = ccw ? u1x : -u1x;
    const n2x = ccw ? -u2y : u2y;
    const n2y = ccw ? u2x : -u2x;

    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-8) {
      out.push([cur[0] + n1x * insetM, cur[1] + n1y * insetM]);
      continue;
    }
    mx /= ml;
    my /= ml;
    const cosHalf = n1x * mx + n1y * my;
    let miterLen =
      cosHalf > 0.18 ? insetM / cosHalf : insetM;
    // Cap miters so sharp concave corners don't spike across the sector
    miterLen = Math.min(miterLen, insetM * 2.5);
    out.push([cur[0] + mx * miterLen, cur[1] + my * miterLen]);
  }

  const insetLL = out.map(toLL);
  const insetArea = Math.abs(signedAreaXY(out));
  const outerArea = Math.abs(area);
  // Collapsed / inverted inset → fall back
  if (insetArea < outerArea * 0.15 || insetArea > outerArea * 0.999) {
    return shrinkRing(ring, insetM);
  }
  return closeRing(insetLL);
}

/**
 * Wall as MultiPolygon of edge quads (outer edge → inset edge).
 * Avoids polygon-with-hole extrusion spikes on concave sectors like H8.
 */
export function wallBandMultiPolygon(
  ring: [number, number][],
  thicknessM: number
): [number, number][][][] {
  const outer = cleanRing(ring);
  const outerPts = outer.slice(0, -1);
  if (outerPts.length < 3) {
    return [[outer]];
  }

  const inner = insetRing(outer, thicknessM);
  const innerPts = inner.slice(0, -1);
  if (innerPts.length !== outerPts.length) {
    // Fallback: single ring with hole (old path)
    const hole = [...inner].reverse();
    return [[outer, hole]];
  }

  const polys: [number, number][][][] = [];
  const n = outerPts.length;
  for (let i = 0; i < n; i++) {
    const a = outerPts[i]!;
    const b = outerPts[(i + 1) % n]!;
    const bi = innerPts[(i + 1) % n]!;
    const ai = innerPts[i]!;
    // Skip degenerate quads from tiny cleaned edges
    if (
      haversineMeters({ lat: a[1], lng: a[0] }, { lat: b[1], lng: b[0] }) < 2
    ) {
      continue;
    }
    polys.push([closeRing([a, b, bi, ai])]);
  }
  return polys.length > 0 ? polys : [[outer, [...inner].reverse()]];
}

/**
 * Thin wall band polygon: outer boundary + inset hole.
 * Prefer wallBandMultiPolygon for Mapbox fill-extrusion.
 */
export function wallBandCoordinates(
  ring: [number, number][],
  thicknessM: number
): [number, number][][] {
  const outer = cleanRing(ring);
  const inner = insetRing(outer, thicknessM);
  const hole = [...inner].reverse();
  return [outer, hole];
}

export function ringToFeature(
  id: string,
  name: string,
  ring: [number, number][]
) {
  return {
    type: "Feature" as const,
    properties: { id, name },
    geometry: {
      type: "Polygon" as const,
      coordinates: [closeRing(ring)],
    },
  };
}
