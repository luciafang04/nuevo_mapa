import OpenAI from "openai";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type AnalyzeAreaRequest = {
  lat?: number;
  lon?: number;
};

type CoordinatesToolResult = {
  lat: number;
  lon: number;
  label: string;
  warning?: string;
};

type NominatimReverseResponse = {
  display_name?: string;
};

type UrbanToolResult = {
  amenities: string[];
  landuse: string[];
  warning?: string;
};

type FloodRiskToolResult = {
  risk: "bajo" | "medio" | "alto" | "desconocido";
  source: string;
  matchedZones: string[];
  warning?: string;
};

type CopernicusObservation = {
  date: string;
  cloudCover: number | null;
  satellite: string | null;
  tile: string | null;
  productId: string;
};

type CopernicusToolResult = {
  source: "Copernicus Data Space Ecosystem STAC";
  collection: "Sentinel-2 Level-2A";
  observations: CopernicusObservation[];
  summary: string;
  warning?: string;
};

type IgnAdministrativeUnit = {
  name: string;
  level: string;
};

type IgnLandUse = {
  category: string;
  observationDate: string | null;
  validFrom: string | null;
  validTo: string | null;
};

type IgnToolResult = {
  source: "IGN/IDEE OGC API Features";
  administrativeUnits: IgnAdministrativeUnit[];
  landUses: IgnLandUse[];
  summary: string;
  warning?: string;
};

type AreaReport = {
  description: string;
  infrastructure: string;
  risks: string;
  urbanUses: string;
  recommendation: string;
  limitations: string;
};

type ToolContext = {
  coordinates: CoordinatesToolResult;
  urban: UrbanToolResult;
  floodRisk: FloodRiskToolResult;
  copernicus: CopernicusToolResult;
  ign: IgnToolResult;
};

const MODEL = "gpt-4.1-mini";
const EXTERNAL_FETCH_TIMEOUT_MS = 12_000;

const reportSchema = {
  type: "object",
  properties: {
    description: { type: "string" },
    infrastructure: { type: "string" },
    risks: { type: "string" },
    urbanUses: { type: "string" },
    recommendation: { type: "string" },
    limitations: { type: "string" },
  },
  required: [
    "description",
    "infrastructure",
    "risks",
    "urbanUses",
    "recommendation",
    "limitations",
  ],
  additionalProperties: false,
} as const;

const urbanAmenityLabels: Record<string, string> = {
  bus_station: "estaciones de autobuses",
  bus_stop: "paradas de autobús",
  hospital: "hospitales",
  platform: "andenes o plataformas de transporte público",
  school: "centros educativos",
  station: "estaciones de transporte",
  stop: "puntos de parada de transporte público",
  stop_area: "áreas de parada de transporte público",
  stop_position: "puntos de detención de transporte público",
  subway_entrance: "accesos al metro",
  tram_stop: "paradas de tranvía",
};

const landuseLabels: Record<string, string> = {
  residential: "uso residencial",
};

const hilucsLandUseLabels: Record<string, string> = {
  "1_PrimaryProduction": "uso de produccion primaria",
  "1_1_Agriculture": "uso agricola",
  "1_2_Forestry": "uso forestal",
  "1_3_MiningAndQuarrying": "mineria y canteras",
  "1_4_AquacultureAndFishing": "acuicultura y pesca",
  "2_SecondaryProduction": "uso industrial o de produccion secundaria",
  "3_TertiaryProduction": "servicios y actividades terciarias",
  "4_TransportNetworksLogisticsAndUtilities":
    "redes de transporte, logistica y servicios urbanos",
  "5_ResidentialUse": "uso residencial",
  "6_OtherUses": "otros usos",
  "6_1_TransitionalAreas": "areas en transicion",
  "6_2_AbandonedAreas": "areas abandonadas",
  "6_3_NaturalAreasNotInOtherEconomicUse":
    "areas naturales sin otro uso economico",
};

type CopernicusStacFeature = {
  id?: string;
  properties?: {
    datetime?: string;
    "eo:cloud_cover"?: number;
    platform?: string;
    "s2:mgrs_tile"?: string;
  };
};

type CopernicusStacResponse = {
  features?: CopernicusStacFeature[];
};

type IgnFeature = {
  properties?: Record<string, unknown>;
};

type IgnFeatureCollection = {
  features?: IgnFeature[];
};

function maskApiKey(apiKey: string) {
  if (apiKey.length <= 8) {
    return "***";
  }

  return `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function extractOutputText(response: {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}) {
  if (response.output_text) {
    return response.output_text.trim();
  }

  const texts: string[] = [];

  for (const item of response.output ?? []) {
    if (item.type !== "message") {
      continue;
    }

    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) {
        texts.push(content.text);
      }
    }
  }

  return texts.join("\n").trim();
}

function isAreaReport(value: unknown): value is AreaReport {
  if (!value || typeof value !== "object") {
    return false;
  }

  const report = value as Record<string, unknown>;

  return (
    typeof report.description === "string" &&
    typeof report.infrastructure === "string" &&
    typeof report.risks === "string" &&
    typeof report.urbanUses === "string" &&
    typeof report.recommendation === "string" &&
    typeof report.limitations === "string"
  );
}

function normalizeLabels(values: unknown, labels: Record<string, string>) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => labels[value] ?? value.replaceAll("_", " ")),
    ),
  ).sort((a, b) => a.localeCompare(b, "es"));
}

function getStringProperty(
  properties: Record<string, unknown> | undefined,
  key: string,
) {
  const value = properties?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getCodeListLastValue(value: string | null) {
  if (!value) {
    return null;
  }

  return value.split("/").at(-1) ?? value;
}

function getHilucsLandUseLabel(value: string | null) {
  const code = getCodeListLastValue(value);

  if (!code) {
    return null;
  }

  return hilucsLandUseLabels[code] ?? code.replaceAll("_", " ");
}

function buildSmallBbox(lat: number, lon: number) {
  const delta = 0.001;

  return [lon - delta, lat - delta, lon + delta, lat + delta].join(",");
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchLocalJson(path: string, request: Request) {
  const url = new URL(path, request.url);
  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    },
    EXTERNAL_FETCH_TIMEOUT_MS,
  );

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    throw new Error(
      typeof data.error === "string" ? data.error : "Local tool request failed.",
    );
  }

  return data;
}

async function buscarCoordenadas(lat: number, lon: number) {
  const nominatimUrl = new URL("https://nominatim.openstreetmap.org/reverse");
  nominatimUrl.searchParams.set("format", "json");
  nominatimUrl.searchParams.set("lat", String(lat));
  nominatimUrl.searchParams.set("lon", String(lon));

  try {
    const response = await fetchWithTimeout(
      nominatimUrl,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "mapas-next-app/0.1.0 contacto-local",
        },
        cache: "no-store",
      },
      EXTERNAL_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error("Reverse geocoding request failed.");
    }

    const data = (await response.json()) as NominatimReverseResponse;
    const label = data.display_name?.trim();

    return {
      lat,
      lon,
      label: label || "Ubicación desconocida",
    } satisfies CoordinatesToolResult;
  } catch (error) {
    return {
      lat,
      lon,
      label: "Ubicación desconocida",
      warning:
        error instanceof Error
          ? error.message
          : "No se pudo obtener la ubicacion por reverse geocoding.",
    } satisfies CoordinatesToolResult;
  }
}

async function capasUrbanismo(lat: number, lon: number, request: Request) {
  try {
    const data = await fetchLocalJson(`/api/urban?lat=${lat}&lon=${lon}`, request);

    return {
      amenities: normalizeLabels(data.amenities, urbanAmenityLabels),
      landuse: normalizeLabels(data.landuse, landuseLabels),
    } satisfies UrbanToolResult;
  } catch (error) {
    return {
      amenities: [],
      landuse: [],
      warning:
        error instanceof Error
          ? error.message
          : "No se pudieron obtener datos de urbanismo.",
    } satisfies UrbanToolResult;
  }
}

async function riesgoInundacion(lat: number, lon: number, request: Request) {
  try {
    const data = await fetchLocalJson(
      `/api/flood-risk?lat=${lat}&lon=${lon}`,
      request,
    );

    const risk =
      data.risk === "bajo" || data.risk === "medio" || data.risk === "alto"
        ? data.risk
        : "desconocido";

    return {
      risk,
      source:
        typeof data.source === "string" && data.source.trim()
          ? data.source.trim()
          : "Fuente oficial no especificada",
      matchedZones: Array.isArray(data.matchedZones)
        ? data.matchedZones.filter(
            (value): value is string =>
              typeof value === "string" && value.trim().length > 0,
          )
        : [],
    } satisfies FloodRiskToolResult;
  } catch (error) {
    return {
      risk: "desconocido",
      source: "Sistema Nacional de Cartografía de Zonas Inundables (MITECO/SNCZI)",
      matchedZones: [],
      warning:
        error instanceof Error
          ? error.message
          : "No se pudieron obtener datos oficiales de riesgo de inundación.",
    } satisfies FloodRiskToolResult;
  }
}

function getIsoDateDaysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function observacionCopernicus(lat: number, lon: number) {
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = getIsoDateDaysAgo(365);

  try {
    const response = await fetchWithTimeout(
      "https://stac.dataspace.copernicus.eu/v1/search",
      {
        method: "POST",
        headers: {
          Accept: "application/geo+json, application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collections: ["sentinel-2-l2a"],
          intersects: {
            type: "Point",
            coordinates: [lon, lat],
          },
          datetime: `${oneYearAgo}T00:00:00Z/${today}T23:59:59Z`,
          limit: 5,
          sortby: [
            {
              field: "properties.datetime",
              direction: "desc",
            },
          ],
          fields: {
            include: [
              "id",
              "properties.datetime",
              "properties.eo:cloud_cover",
              "properties.platform",
              "properties.s2:mgrs_tile",
            ],
            exclude: ["assets", "geometry", "links"],
          },
        }),
        cache: "no-store",
      },
      EXTERNAL_FETCH_TIMEOUT_MS,
    );

    if (!response.ok) {
      throw new Error("Copernicus STAC request failed.");
    }

    const data = (await response.json()) as CopernicusStacResponse;
    const observations = (data.features ?? []).flatMap((feature) => {
      const datetime = feature.properties?.datetime;
      const productId = feature.id;

      if (!datetime || !productId) {
        return [];
      }

      return [
        {
          date: datetime.slice(0, 10),
          cloudCover:
            typeof feature.properties?.["eo:cloud_cover"] === "number"
              ? feature.properties["eo:cloud_cover"]
              : null,
          satellite: feature.properties?.platform ?? null,
          tile: feature.properties?.["s2:mgrs_tile"] ?? null,
          productId,
        },
      ];
    });

    return {
      source: "Copernicus Data Space Ecosystem STAC",
      collection: "Sentinel-2 Level-2A",
      observations,
      summary:
        observations.length > 0
          ? `Se han encontrado ${observations.length} observaciones Sentinel-2 L2A recientes que intersectan la ubicacion.`
          : "No se han encontrado observaciones Sentinel-2 L2A recientes para la ubicacion en el ultimo ano.",
      warning:
        observations.length === 0
          ? "Copernicus no devolvio escenas Sentinel-2 L2A recientes para el punto consultado."
          : undefined,
    } satisfies CopernicusToolResult;
  } catch (error) {
    return {
      source: "Copernicus Data Space Ecosystem STAC",
      collection: "Sentinel-2 Level-2A",
      observations: [],
      summary:
        "No se pudo consultar Copernicus para obtener observaciones Sentinel-2 L2A de la ubicacion.",
      warning:
        error instanceof Error
          ? error.message
          : "No se pudo consultar Copernicus.",
    } satisfies CopernicusToolResult;
  }
}

async function fetchIgnFeatures(url: URL) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        Accept: "application/geo+json, application/json",
      },
      cache: "no-store",
    },
    EXTERNAL_FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error("IGN/IDEE feature request failed.");
  }

  return (await response.json()) as IgnFeatureCollection;
}

async function consultaIgn(lat: number, lon: number) {
  const bbox = buildSmallBbox(lat, lon);

  try {
    const administrativeUrl = new URL(
      "https://api-features.ign.es/collections/administrativeunit/items",
    );
    administrativeUrl.searchParams.set("f", "json");
    administrativeUrl.searchParams.set("bbox", bbox);
    administrativeUrl.searchParams.set("limit", "20");

    const landUseUrl = new URL(
      "https://api-features.idee.es/collections/existinglanduseobject/items",
    );
    landUseUrl.searchParams.set("f", "json");
    landUseUrl.searchParams.set("bbox", bbox);
    landUseUrl.searchParams.set("limit", "10");

    const [administrativeData, landUseData] = await Promise.all([
      fetchIgnFeatures(administrativeUrl),
      fetchIgnFeatures(landUseUrl),
    ]);

    const administrativeUnits = Array.from(
      new Map(
        (administrativeData.features ?? []).flatMap((feature) => {
          const name = getStringProperty(feature.properties, "nameunit");
          const level = getStringProperty(
            feature.properties,
            "nationallevelname",
          );

          if (!name || !level) {
            return [];
          }

          return [[`${level}:${name}`, { name, level }]];
        }),
      ).values(),
    ).sort((a, b) => a.level.localeCompare(b.level, "es"));

    const landUses = Array.from(
      new Map(
        (landUseData.features ?? []).flatMap((feature) => {
          const category = getHilucsLandUseLabel(
            getStringProperty(feature.properties, "hilucslanduse"),
          );

          if (!category) {
            return [];
          }

          const landUse = {
            category,
            observationDate: getStringProperty(
              feature.properties,
              "observationdate",
            ),
            validFrom: getStringProperty(feature.properties, "validfrom"),
            validTo: getStringProperty(feature.properties, "validto"),
          };

          return [[category, landUse]];
        }),
      ).values(),
    ).sort((a, b) => a.category.localeCompare(b.category, "es"));

    return {
      source: "IGN/IDEE OGC API Features",
      administrativeUnits,
      landUses,
      summary:
        administrativeUnits.length > 0 || landUses.length > 0
          ? "Se han obtenido datos oficiales de unidades administrativas del IGN y uso del suelo SIOSE desde IDEE."
          : "IGN/IDEE no devolvio unidades administrativas ni uso del suelo para el area consultada.",
      warning:
        administrativeUnits.length === 0 && landUses.length === 0
          ? "IGN/IDEE no devolvio elementos para el area consultada."
          : undefined,
    } satisfies IgnToolResult;
  } catch (error) {
    return {
      source: "IGN/IDEE OGC API Features",
      administrativeUnits: [],
      landUses: [],
      summary:
        "No se pudo consultar IGN/IDEE para obtener unidades administrativas o uso oficial del suelo.",
      warning:
        error instanceof Error
          ? error.message
          : "No se pudo consultar IGN/IDEE.",
    } satisfies IgnToolResult;
  }
}

function buildLimitations(context: ToolContext) {
  return [
    context.coordinates.warning,
    context.urban.warning,
    context.floodRisk.warning,
    context.copernicus.warning,
    context.ign.warning,
    context.urban.amenities.length === 0 && context.urban.landuse.length === 0
      ? "No se han encontrado equipamientos o usos del suelo en el radio consultado, o la fuente no devolvio elementos."
      : null,
    context.floodRisk.risk === "desconocido"
      ? "No hay suficiente información para clasificar el riesgo de inundación con fiabilidad a partir de la cartografía oficial consultada."
      : null,
  ].filter((value): value is string => Boolean(value));
}

function takeTop(values: string[], limit: number) {
  return values.slice(0, limit);
}

function buildCompactContext(context: ToolContext, limitations: string[]) {
  return {
    location: {
      lat: Number(context.coordinates.lat.toFixed(6)),
      lon: Number(context.coordinates.lon.toFixed(6)),
      label: context.coordinates.label,
    },
    urban: {
      amenitiesCount: context.urban.amenities.length,
      landuseCount: context.urban.landuse.length,
      amenities: takeTop(context.urban.amenities, 8),
      landuse: takeTop(context.urban.landuse, 5),
    },
    floodRisk: {
      risk: context.floodRisk.risk,
      source: context.floodRisk.source,
      matchedZones: takeTop(context.floodRisk.matchedZones, 5),
    },
    copernicus: {
      summary: context.copernicus.summary,
      observationsCount: context.copernicus.observations.length,
      observations: context.copernicus.observations.slice(0, 3).map((item) => ({
        date: item.date,
        cloudCover: item.cloudCover,
        satellite: item.satellite,
        tile: item.tile,
      })),
    },
    ign: {
      summary: context.ign.summary,
      administrativeUnits: context.ign.administrativeUnits.slice(0, 5),
      landUses: context.ign.landUses.slice(0, 5),
    },
    limitations,
  };
}

async function generateReportWithLlm(
  context: ToolContext,
  limitations: string[],
) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY environment variable.");
  }

  console.log(
    `[analyze-area] OPENAI_API_KEY exists: ${maskApiKey(apiKey)}`,
  );
  console.log(`[analyze-area] calling OpenAI model: ${MODEL}`);

  const openai = new OpenAI({
    apiKey,
    timeout: 15000,
    maxRetries: 0,
  });

  const compactContext = buildCompactContext(context, limitations);

  const response = await openai.responses.create({
    model: MODEL,
    max_output_tokens: 500,
    prompt_cache_key: "analyze-area-report-v1",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Eres un analista territorial. Escribe solo en español, con frases cortas, ortografía española correcta y sin tecnicismos innecesarios. Usa tildes, eñes y mayúsculas correctamente en todo el texto. Usa solo los datos aportados. No inventes nombres, distancias ni riesgos. Si faltan datos, indícalo en limitations. Devuelve solo JSON válido ajustado al schema.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Genera un informe estructurado para esta zona usando exclusivamente estos datos:\n${JSON.stringify(
              compactContext,
              null,
              2,
            )}`,
          },
        ],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "area_report",
        strict: true,
        schema: reportSchema,
      },
    },
  });

  console.log("[analyze-area] received response from OpenAI");

  const outputText = extractOutputText(response);

  if (!outputText) {
    throw new Error("OpenAI did not return a final report.");
  }

  const report = JSON.parse(outputText) as unknown;

  if (!isAreaReport(report)) {
    throw new Error("OpenAI returned an invalid report shape.");
  }

  return report;
}

export async function POST(request: Request) {
  try {
    console.log("[analyze-area] entered endpoint");

    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      console.error("[analyze-area] missing OPENAI_API_KEY");
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY environment variable." },
        { status: 500 },
      );
    }

    console.log(
      `[analyze-area] OPENAI_API_KEY exists: ${maskApiKey(apiKey)}`,
    );

    let body: AnalyzeAreaRequest;

    try {
      body = (await request.json()) as AnalyzeAreaRequest;
    } catch {
      console.error("[analyze-area] invalid JSON body");
      return NextResponse.json(
        { error: "Invalid JSON body." },
        { status: 500 },
      );
    }

    const lat = Number(body.lat);
    const lon = Number(body.lon);

    if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
      console.error("[analyze-area] invalid lat/lon", {
        lat: body.lat,
        lon: body.lon,
      });
      return NextResponse.json(
        { error: "Invalid or missing lat/lon." },
        { status: 500 },
      );
    }

    console.log("[analyze-area] starting tool execution", { lat, lon });

    const [coordinates, urban, floodRisk, copernicus, ign] = await Promise.all([
      buscarCoordenadas(lat, lon),
      capasUrbanismo(lat, lon, request),
      riesgoInundacion(lat, lon, request),
      observacionCopernicus(lat, lon),
      consultaIgn(lat, lon),
    ]);

    console.log("[analyze-area] tools completed", {
      coordinates: coordinates.warning ? "warning" : "ok",
      urban: urban.warning ? "warning" : "ok",
      floodRisk: floodRisk.warning ? "warning" : "ok",
      copernicus: copernicus.warning ? "warning" : "ok",
      ign: ign.warning ? "warning" : "ok",
    });

    const toolContext: ToolContext = {
      coordinates,
      urban,
      floodRisk,
      copernicus,
      ign,
    };

    const limitations = buildLimitations(toolContext);

    console.log("[analyze-area] before OpenAI request", {
      limitationsCount: limitations.length,
    });

    const report = await generateReportWithLlm(toolContext, limitations);

    console.log("[analyze-area] report generated successfully");

    return NextResponse.json(report, { status: 200 });
  } catch (error) {
    console.error("[analyze-area] error", getErrorMessage(error));

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unexpected server error.",
      },
      { status: 500 },
    );
  }
}
