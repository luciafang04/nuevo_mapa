import { NextResponse } from "next/server";

type OverpassElement = {
  tags?: {
    amenity?: string;
    public_transport?: string;
    railway?: string;
    highway?: string;
    landuse?: string;
  };
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

const SEARCH_RADIUS_METERS = 500;

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function buildOverpassQuery(lat: number, lon: number) {
  return `
    [out:json][timeout:25];
    (
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["amenity"~"^(school|hospital|bus_station)$"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["public_transport"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["railway"~"^(station|halt|tram_stop|subway_entrance)$"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["highway"="bus_stop"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["landuse"="residential"];
    );
    out tags;
  `;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));

  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return NextResponse.json(
      { error: "Invalid or missing 'lat' and 'lon' query params." },
      { status: 400 },
    );
  }

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "text/plain;charset=UTF-8",
        "User-Agent": "mapas-next-app/0.1.0",
      },
      body: buildOverpassQuery(lat, lon),
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Urban data request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as OverpassResponse;
    const amenities = new Set<string>();
    const landuse = new Set<string>();

    for (const element of data.elements ?? []) {
      const tags = element.tags;

      if (!tags) {
        continue;
      }

      if (tags.amenity) {
        amenities.add(tags.amenity);
      }

      if (tags.public_transport) {
        amenities.add(tags.public_transport);
      }

      if (tags.railway) {
        amenities.add(tags.railway);
      }

      if (tags.highway === "bus_stop") {
        amenities.add(tags.highway);
      }

      if (tags.landuse) {
        landuse.add(tags.landuse);
      }
    }

    return NextResponse.json({
      amenities: Array.from(amenities).sort(),
      landuse: Array.from(landuse).sort(),
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected urban data error." },
      { status: 500 },
    );
  }
}
