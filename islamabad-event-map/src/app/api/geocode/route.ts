import { NextRequest, NextResponse } from "next/server";
import type { CityId } from "@/lib/constants";
import { CITY_CONFIG, CITIES } from "@/lib/constants";

export type GeocodeApiPlace = {
  id: string;
  name: string;
  placeName: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
};

type NominatimRow = {
  place_id?: number | string;
  display_name?: string;
  name?: string;
  lat?: string;
  lon?: string;
  boundingbox?: [string, string, string, string];
};

function isCityId(value: string): value is CityId {
  return (CITIES as readonly string[]).includes(value);
}

function parsePlaces(data: unknown): GeocodeApiPlace[] {
  if (!Array.isArray(data)) return [];

  const places: GeocodeApiPlace[] = [];
  for (const row of data as NominatimRow[]) {
    const lat = Number(row.lat);
    const lng = Number(row.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    let bbox: GeocodeApiPlace["bbox"];
    if (row.boundingbox?.length === 4) {
      const southB = Number(row.boundingbox[0]);
      const northB = Number(row.boundingbox[1]);
      const westB = Number(row.boundingbox[2]);
      const eastB = Number(row.boundingbox[3]);
      if ([southB, northB, westB, eastB].every((n) => Number.isFinite(n))) {
        bbox = [westB, southB, eastB, northB];
      }
    }

    const placeName = row.display_name || row.name || "Place";
    const shortName = row.name || placeName.split(",")[0]?.trim() || "Place";

    places.push({
      id: String(row.place_id ?? `${lat},${lng}`),
      name: shortName,
      placeName,
      lat,
      lng,
      bbox,
    });
  }
  return places;
}

async function nominatimSearch(
  q: string,
  opts: {
    viewbox?: string;
    countrycodes?: string;
  } = {}
): Promise<GeocodeApiPlace[]> {
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    addressdetails: "1",
    limit: "8",
    "accept-language": "en",
  });
  if (opts.viewbox) {
    params.set("viewbox", opts.viewbox);
    params.set("bounded", "0");
  }
  if (opts.countrycodes) {
    params.set("countrycodes", opts.countrycodes);
  }

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "User-Agent": "IslamabadExplore/1.0 (place search for map pinning)",
      },
      next: { revalidate: 0 },
    }
  );
  if (!res.ok) return [];
  return parsePlaces(await res.json());
}

/**
 * World place search (Nominatim) biased toward the active city map,
 * so explorers can jump the camera and drop a pin more easily.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  const cityParam = (req.nextUrl.searchParams.get("city") || "").trim();

  if (q.length < 2) {
    return NextResponse.json({ places: [] as GeocodeApiPlace[] });
  }

  const city: CityId = isCityId(cityParam) ? cityParam : "islamabad";
  const config = CITY_CONFIG[city];
  const [[west, south], [east, north]] = config.maxBounds;
  const viewbox = `${west},${north},${east},${south}`;
  const cityLabel = config.label;

  // 1) Prefer results near the active city (soft viewbox, not hard-bounded)
  let places = await nominatimSearch(q, { viewbox });

  // 2) If nothing local, try with city name appended (helps "F-10", "Blue Area")
  const mentionsCity = new RegExp(cityLabel, "i").test(q);
  if (places.length === 0 && !mentionsCity) {
    places = await nominatimSearch(`${q}, ${cityLabel}, Pakistan`, {
      viewbox,
      countrycodes: "pk",
    });
  }

  // 3) Still empty → unrestricted world search
  if (places.length === 0) {
    places = await nominatimSearch(q);
  }

  // Dedupe by id
  const seen = new Set<string>();
  const unique = places.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });

  return NextResponse.json({ places: unique.slice(0, 8) });
}
