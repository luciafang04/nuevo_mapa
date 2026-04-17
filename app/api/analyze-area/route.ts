import OpenAI from "openai";
import type { FunctionTool } from "openai/resources/responses/responses";
import { NextResponse } from "next/server";

type ToolCall = {
  type: string;
  call_id?: string | null;
  name?: string | null;
  arguments?: string | null;
};

type GeocodeResult = {
  lat: number;
  lon: number;
  display_name?: string;
  name?: string;
  error?: string;
};

type UrbanResult = {
  amenities?: string[];
  landuse?: string[];
  error?: string;
};

type FloodRiskResult = {
  risk?: "bajo" | "medio" | "alto";
  nearbyWater?: string[];
  error?: string;
};

const ANALYSIS_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

const reportSchema = {
  type: "object",
  properties: {
    descripcionZona: {
      type: "string",
    },
    infraestructuraCercana: {
      type: "array",
      items: { type: "string" },
    },
    riesgos: {
      type: "array",
      items: { type: "string" },
    },
    usosUrbanosPosibles: {
      type: "array",
      items: { type: "string" },
    },
    recomendacionFinal: {
      type: "string",
    },
    limitacionesDatos: {
      type: "array",
      items: { type: "string" },
    },
    datosBase: {
      type: "object",
      properties: {
        coordenadas: {
          type: "object",
          properties: {
            lat: { type: "number" },
            lon: { type: "number" },
            nombre: {
              anyOf: [{ type: "string" }, { type: "null" }],
            },
          },
          required: ["lat", "lon", "nombre"],
          additionalProperties: false,
        },
        urbanismo: {
          type: "object",
          properties: {
            amenities: {
              type: "array",
              items: { type: "string" },
            },
            landuse: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["amenities", "landuse"],
          additionalProperties: false,
        },
        inundacion: {
          type: "object",
          properties: {
            risk: {
              type: "string",
              enum: ["bajo", "medio", "alto"],
            },
            nearbyWater: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["risk", "nearbyWater"],
          additionalProperties: false,
        },
      },
      required: ["coordenadas", "urbanismo", "inundacion"],
      additionalProperties: false,
    },
  },
  required: [
    "descripcionZona",
    "infraestructuraCercana",
    "riesgos",
    "usosUrbanosPosibles",
    "recomendacionFinal",
    "limitacionesDatos",
    "datosBase",
  ],
  additionalProperties: false,
} as const;

function isValidLatitude(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

function extractOutputText(response: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}) {
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

function getFunctionCalls(response: { output?: unknown[] }) {
  return (response.output ?? []).filter(
    (item): item is ToolCall =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      "call_id" in item &&
      "name" in item &&
      "arguments" in item &&
      (item as ToolCall).type === "function_call" &&
      typeof (item as ToolCall).call_id === "string" &&
      typeof (item as ToolCall).name === "string" &&
      typeof (item as ToolCall).arguments === "string",
  );
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

async function executeToolCall(
  toolCall: ToolCall,
  request: Request,
) {
  const args = JSON.parse(toolCall.arguments ?? "{}") as Record<string, unknown>;

  switch (toolCall.name) {
    case "buscarCoordenadas": {
      const direccion = String(args.direccion ?? "").trim();

      if (!direccion) {
        throw new Error("La tool buscarCoordenadas requiere una direccion.");
      }

      return fetchLocalJson(
        `/api/geocode?q=${encodeURIComponent(direccion)}`,
        request,
      );
    }

    case "capasUrbanismo": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);

      if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
        throw new Error("La tool capasUrbanismo requiere lat y lon validos.");
      }

      return fetchLocalJson(`/api/urban?lat=${lat}&lon=${lon}`, request);
    }

    case "riesgoInundacion": {
      const lat = Number(args.lat);
      const lon = Number(args.lon);

      if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
        throw new Error(
          "La tool riesgoInundacion requiere lat y lon validos.",
        );
      }

      return fetchLocalJson(`/api/flood-risk?lat=${lat}&lon=${lon}`, request);
    }

    default:
      throw new Error(`Tool no soportada: ${toolCall.name}`);
  }
}

export async function GET(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "Missing OPENAI_API_KEY environment variable." },
      { status: 500 },
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address")?.trim() ?? "";
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const hasCoordinates = isValidLatitude(lat) && isValidLongitude(lon);

  if (!address && !hasCoordinates) {
    return NextResponse.json(
      { error: "Provide either a valid address or valid lat and lon." },
      { status: 400 },
    );
  }

  const tools: FunctionTool[] = [
    {
      type: "function",
      name: "buscarCoordenadas",
      description:
        "Convierte una direccion postal o nombre de lugar en coordenadas lat/lon.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          direccion: {
            type: "string",
            description: "Direccion o lugar a geocodificar.",
          },
        },
        required: ["direccion"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "capasUrbanismo",
      description:
        "Obtiene equipamientos y usos del suelo cercanos a unas coordenadas.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "riesgoInundacion",
      description:
        "Devuelve una estimacion simple del riesgo de inundacion y agua cercana.",
      strict: true,
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number" },
          lon: { type: "number" },
        },
        required: ["lat", "lon"],
        additionalProperties: false,
      },
    },
  ];

  const instructions = `
Eres un analista territorial. Debes producir un informe unicamente con resultados de tools.
No inventes datos, nombres, distancias, infraestructura ni riesgos que no aparezcan en las tools.
Si falta evidencia para una seccion, indicalo explicitamente en esa seccion o en limitacionesDatos.
Si recibes una direccion, primero debes usar buscarCoordenadas.
Siempre debes usar capasUrbanismo y riesgoInundacion con las coordenadas resueltas finales.
Si el usuario envio direccion y coordenadas, prioriza la direccion y usa buscarCoordenadas.
Devuelve el informe final en espanol y en formato JSON ajustado al schema solicitado.
`;

  const userContext = address
    ? `Analiza esta zona a partir de la direccion: ${address}`
    : `Analiza esta zona a partir de estas coordenadas: lat=${lat}, lon=${lon}`;

  try {
    let response = await openai.responses.create({
      model: ANALYSIS_MODEL,
      instructions,
      input: [{ role: "user", content: userContext }],
      tools,
      parallel_tool_calls: true,
      text: {
        format: {
          type: "json_schema",
          name: "area_report",
          strict: true,
          schema: reportSchema,
        },
      },
    });

    const usedTools = new Set<string>();
    let safetyCounter = 0;

    while (safetyCounter < 6) {
      const functionCalls = getFunctionCalls(response);

      if (functionCalls.length === 0) {
        break;
      }

      const toolOutputs = await Promise.all(
        functionCalls.map(async (toolCall) => {
          usedTools.add(toolCall.name!);

          try {
            const result = await executeToolCall(toolCall, request);

            return {
              type: "function_call_output" as const,
              call_id: toolCall.call_id!,
              output: JSON.stringify(result),
            };
          } catch (error) {
            return {
              type: "function_call_output" as const,
              call_id: toolCall.call_id!,
              output: JSON.stringify({
                error:
                  error instanceof Error
                    ? error.message
                    : "Tool execution failed.",
              }),
            };
          }
        }),
      );

      response = await openai.responses.create({
        model: ANALYSIS_MODEL,
        instructions,
        previous_response_id: response.id,
        input: toolOutputs,
        tools,
        parallel_tool_calls: true,
        text: {
          format: {
            type: "json_schema",
            name: "area_report",
            strict: true,
            schema: reportSchema,
          },
        },
      });

      safetyCounter += 1;
    }

    if (address && !usedTools.has("buscarCoordenadas")) {
      return NextResponse.json(
        { error: "The model did not resolve the address with buscarCoordenadas." },
        { status: 502 },
      );
    }

    if (
      !usedTools.has("capasUrbanismo") ||
      !usedTools.has("riesgoInundacion")
    ) {
      return NextResponse.json(
        { error: "The model did not use all required tools." },
        { status: 502 },
      );
    }

    const outputText = extractOutputText(response);

    if (!outputText) {
      return NextResponse.json(
        { error: "OpenAI did not return a final report." },
        { status: 502 },
      );
    }

    return NextResponse.json(JSON.parse(outputText));
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected analyze-area error.",
      },
      { status: 500 },
    );
  }
}
