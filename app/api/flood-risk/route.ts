import { NextResponse } from "next/server";

type OverpassElement = {
  lat?: number;
  lon?: number;
  center?: {
    lat: number;
    lon: number;
  };
  tags?: {
    waterway?: string;
    natural?: string;
    water?: string;
    landuse?: string;
  };
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

const SEARCH_RADIUS_METERS = 1000;

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
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["waterway"~"^(river|stream|canal)$"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["natural"="water"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["water"~"^(lake|reservoir|pond|basin|lagoon)$"];
      nwr(around:${SEARCH_RADIUS_METERS},${lat},${lon})["landuse"~"^(reservoir|basin)$"];
    );
    out center tags;
  `;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
) {
  const earthRadius = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getElementCoordinates(element: OverpassElement) {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lon: element.lon };
  }

  if (element.center) {
    return element.center;
  }

  return null;
}

function getWaterType(element: OverpassElement) {
  const tags = element.tags;

  if (!tags) {
    return null;
  }

  if (tags.waterway === "river") {
    return "river";
  }

  if (tags.water === "lake") {
    return "lake";
  }

  if (
    tags.natural === "water" ||
    tags.water === "reservoir" ||
    tags.water === "pond" ||
    tags.water === "basin" ||
    tags.water === "lagoon" ||
    tags.landuse === "reservoir" ||
    tags.landuse === "basin" ||
    tags.waterway === "stream" ||
    tags.waterway === "canal"
  ) {
    return "water";
  }

  return null;
}

function getRiskLevel(minDistance: number | null) {
  if (minDistance === null) {
    return "bajo";
  }

  if (minDistance <= 200) {
    return "alto";
  }

  if (minDistance <= 500) {
    return "medio";
  }

  return "bajo";
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
        { error: "Flood risk request failed." },
        { status: 502 },
      );
    }

    const data = (await response.json()) as OverpassResponse;
    const nearbyWater = new Set<string>();
    let minDistance: number | null = null;

    for (const element of data.elements ?? []) {
      const waterType = getWaterType(element);
      const coordinates = getElementCoordinates(element);

      if (!waterType || !coordinates) {
        continue;
      }

      nearbyWater.add(waterType);

      const distance = getDistanceMeters(
        lat,
        lon,
        coordinates.lat,
        coordinates.lon,
      );

      if (minDistance === null || distance < minDistance) {
        minDistance = distance;
      }
    }

    return NextResponse.json({
      risk: getRiskLevel(minDistance),
      nearbyWater: Array.from(nearbyWater).sort(),
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected flood risk error." },
      { status: 500 },
    );
  }
}
