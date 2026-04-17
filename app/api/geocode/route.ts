import { NextResponse } from "next/server";

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      { error: "Missing query parameter 'q'." },
      { status: 400 },
    );
  }

  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/search");
  nominatimUrl.searchParams.set("q", query);
  nominatimUrl.searchParams.set("format", "jsonv2");
  nominatimUrl.searchParams.set("limit", "1");

  try {
    const response = await fetch(nominatimUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "mapas-next-app/0.1.0",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Geocoding request failed." },
        { status: 502 },
      );
    }

    const results = (await response.json()) as NominatimResult[];
    const firstResult = results[0];

    if (!firstResult) {
      return NextResponse.json(
        { error: "No results found for the provided query." },
        { status: 404 },
      );
    }

    return NextResponse.json({
      lat: Number(firstResult.lat),
      lon: Number(firstResult.lon),
      display_name: firstResult.display_name,
      name: firstResult.display_name,
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected geocoding error." },
      { status: 500 },
    );
  }
}
