import OpenAI from "openai";
import { NextResponse } from "next/server";

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
  nearbyWater: string[];
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

const ANALYSIS_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

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

const waterLabels: Record<string, string> = {
  canal: "canales",
  lake: "lagos",
  river: "ríos",
  stream: "arroyos",
  water: "masas de agua",
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

  return [
    lon - delta,
    lat - delta,
    lon + delta,
    lat + delta,
  ].join(",");
}

async function fetchLocalJson(path: string, request: Request) {
  const url = new URL(path, request.url);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    cache: "no-store",
  });

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
    const response = await fetch(nominatimUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "mapas-next-app/0.1.0 contacto-local",
      },
      cache: "no-store",
    });

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
  } catch {
    return {
      lat,
      lon,
      label: "Ubicación desconocida",
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
      nearbyWater: normalizeLabels(data.nearbyWater, waterLabels),
    } satisfies FloodRiskToolResult;
  } catch (error) {
    return {
      risk: "desconocido",
      nearbyWater: [],
      warning:
        error instanceof Error
          ? error.message
          : "No se pudieron obtener datos de riesgo de inundacion.",
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
    const response = await fetch("https://stac.dataspace.copernicus.eu/v1/search", {
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
    });

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
  const response = await fetch(url, {
    headers: {
      Accept: "application/geo+json, application/json",
    },
    cache: "no-store",
  });

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
      ? "No hay suficiente informacion para clasificar el riesgo de inundacion con fiabilidad."
      : null,
  ].filter((value): value is string => Boolean(value));
}

async function generateReportWithLlm(context: ToolContext, limitations: string[]) {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.responses.create({
    model: ANALYSIS_MODEL,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "Eres un analista territorial. Debes redactar un informe solo con los datos proporcionados por las tools, incluyendo la observacion satelital de Copernicus y los datos oficiales IGN/IDEE cuando existan. No inventes nombres, distancias, infraestructuras, riesgos ni usos urbanos. No presentes Copernicus como validacion de riesgo si solo aporta metadatos de escenas Sentinel-2. Si IGN/IDEE aporta SIOSE 2017, aclara que es uso oficial del suelo de esa fuente y no una inspeccion actual en tiempo real. Escribe en lenguaje natural, claro y profesional: no copies identificadores tecnicos, claves de API, snake_case ni etiquetas internas como bus_stop, stop_area o subway_entrance. Si faltan datos, dilo con claridad en limitations y en la seccion afectada. Todos los campos deben ser strings en espanol. Devuelve solo un JSON valido ajustado al schema solicitado.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Genera un informe estructurado para esta zona usando exclusivamente estos datos:\n${JSON.stringify(
              {
                tools: {
                  buscarCoordenadas: context.coordinates,
                  capasUrbanismo: context.urban,
                  riesgoInundacion: context.floodRisk,
                  observacionCopernicus: context.copernicus,
                  consultaIgn: context.ign,
                },
                warnings: limitations,
              },
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
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY environment variable." },
      { status: 500 },
    );
  }

  let body: AnalyzeAreaRequest;

  try {
    body = (await request.json()) as AnalyzeAreaRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400 },
    );
  }

  const lat = Number(body.lat);
  const lon = Number(body.lon);

  if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
    return NextResponse.json(
      { error: "Invalid or missing lat/lon." },
      { status: 400 },
    );
  }

  let coordinates: CoordinatesToolResult;
  let urban: UrbanToolResult;
  let floodRisk: FloodRiskToolResult;
  let copernicus: CopernicusToolResult;
  let ign: IgnToolResult;

  try {
    coordinates = await buscarCoordenadas(lat, lon);
    urban = await capasUrbanismo(lat, lon, request);
    floodRisk = await riesgoInundacion(lat, lon, request);
    copernicus = await observacionCopernicus(lat, lon);
    ign = await consultaIgn(lat, lon);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected tool execution error.",
      },
      { status: 502 },
    );
  }

  const toolContext: ToolContext = {
    coordinates,
    urban,
    floodRisk,
    copernicus,
    ign,
  };

  const limitations = buildLimitations(toolContext);

  try {
    const report = await generateReportWithLlm(toolContext, limitations);
    return NextResponse.json(report);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected analyze-area error.",
      },
      { status: 502 },
    );
  }
}
