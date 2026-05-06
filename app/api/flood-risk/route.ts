import { NextResponse } from "next/server";

type FloodRiskLevel = "bajo" | "medio" | "alto" | "desconocido";

type FloodLayerConfig = {
  key: "T10" | "T50" | "T100" | "T500";
  label: string;
  serviceUrl: string;
};

const FLOOD_LAYERS: FloodLayerConfig[] = [
  {
    key: "T10",
    label: "Zona inundable oficial T10 (alta probabilidad)",
    serviceUrl: "https://wms.mapama.gob.es/sig/Agua/ZI_LaminasQ10/wms.aspx",
  },
  {
    key: "T50",
    label: "Zona inundable oficial T50 (probabilidad frecuente)",
    serviceUrl: "https://wms.mapama.gob.es/sig/Agua/ZI_LaminasQ50/wms.aspx",
  },
  {
    key: "T100",
    label: "Zona inundable oficial T100 (probabilidad media)",
    serviceUrl: "https://wms.mapama.gob.es/sig/Agua/ZI_LaminasQ100/wms.aspx",
  },
  {
    key: "T500",
    label: "Zona inundable oficial T500 (probabilidad baja o excepcional)",
    serviceUrl: "https://wms.mapama.gob.es/sig/Agua/ZI_LaminasQ500/wms.aspx",
  },
];

const SNCZI_SOURCE =
  "Sistema Nacional de Cartografía de Zonas Inundables (MITECO/SNCZI)";

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function buildBbox(lat: number, lon: number) {
  const delta = 0.0005;

  return [
    (lon - delta).toFixed(6),
    (lat - delta).toFixed(6),
    (lon + delta).toFixed(6),
    (lat + delta).toFixed(6),
  ].join(",");
}

function buildFeatureInfoUrl(layer: FloodLayerConfig, lat: number, lon: number) {
  const url = new URL(layer.serviceUrl);

  url.searchParams.set("SERVICE", "WMS");
  url.searchParams.set("VERSION", "1.3.0");
  url.searchParams.set("REQUEST", "GetFeatureInfo");
  url.searchParams.set("LAYERS", "NZ.RiskZone");
  url.searchParams.set("QUERY_LAYERS", "NZ.RiskZone");
  url.searchParams.set("INFO_FORMAT", "text/html");
  url.searchParams.set("CRS", "CRS:84");
  url.searchParams.set("BBOX", buildBbox(lat, lon));
  url.searchParams.set("WIDTH", "3");
  url.searchParams.set("HEIGHT", "3");
  url.searchParams.set("I", "1");
  url.searchParams.set("J", "1");

  return url;
}

function responseMeansNoData(text: string) {
  const normalized = text.toLowerCase();

  return (
    normalized.includes("información no encontrada") ||
    normalized.includes("no se han encontrado datos en la ubicación seleccionada")
  );
}

function responseMeansServiceError(text: string) {
  return text.toLowerCase().includes("serviceexception");
}

async function queryFloodLayer(layer: FloodLayerConfig, lat: number, lon: number) {
  const response = await fetch(buildFeatureInfoUrl(layer, lat, lon), {
    headers: {
      Accept: "text/html",
      "User-Agent": "mapas-next-app/0.1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`SNCZI request failed for ${layer.key}.`);
  }

  const body = await response.text();

  if (responseMeansServiceError(body)) {
    throw new Error(`SNCZI returned an invalid response for ${layer.key}.`);
  }

  return !responseMeansNoData(body);
}

function getRiskLevel(matchedLayers: FloodLayerConfig[]): FloodRiskLevel {
  if (matchedLayers.some((layer) => layer.key === "T10" || layer.key === "T50")) {
    return "alto";
  }

  if (matchedLayers.some((layer) => layer.key === "T100")) {
    return "medio";
  }

  if (matchedLayers.some((layer) => layer.key === "T500")) {
    return "bajo";
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
    const queryResults = await Promise.all(
      FLOOD_LAYERS.map(async (layer) => ({
        layer,
        matched: await queryFloodLayer(layer, lat, lon),
      })),
    );

    const matchedLayers = queryResults
      .filter((result) => result.matched)
      .map((result) => result.layer);

    return NextResponse.json({
      risk: getRiskLevel(matchedLayers),
      source: SNCZI_SOURCE,
      matchedZones: matchedLayers.map((layer) => layer.label),
    });
  } catch {
    return NextResponse.json(
      { error: "Unexpected flood risk error." },
      { status: 500 },
    );
  }
}
