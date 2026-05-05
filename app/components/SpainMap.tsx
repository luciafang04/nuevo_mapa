"use client";

import { useMemo, useState } from "react";
import L from "leaflet";
import {
  Download,
  Layers,
  Loader2,
  MapIcon,
  MapPin,
  Satellite,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Coordinates = {
  lat: number;
  lng: number;
};

type GeocodeResponse = {
  lat: number;
  lon: number;
  display_name: string;
  name: string;
};

type Filters = {
  temperature?: boolean;
  precipitation?: boolean;
  humidity?: boolean;
  wind?: boolean;
};

type MapMode = "street" | "satellite";

type WeatherLayerConfig = {
  key: keyof Filters;
  label: string;
  url: string;
  opacity: number;
  zIndex: number;
};

type AreaReport = {
  description: string;
  infrastructure: string;
  risks: string;
  urbanUses: string;
  recommendation: string;
  limitations: string;
  error?: string;
};

const DEFAULT_FILTERS: Filters = {
  temperature: undefined,
  precipitation: undefined,
  humidity: undefined,
  wind: undefined,
};

const WEATHER_LAYERS: WeatherLayerConfig[] = [
  {
    key: "temperature",
    label: "Temperatura",
    url: "https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png",
    opacity: 0.72,
    zIndex: 460,
  },
  {
    key: "precipitation",
    label: "Precipitaciones",
    url: "https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png",
    opacity: 0.7,
    zIndex: 470,
  },
  {
    key: "humidity",
    label: "Humedad",
    url: "https://maps.openweathermap.org/maps/2.0/weather/HRD0/{z}/{x}/{y}",
    opacity: 0.6,
    zIndex: 480,
  },
  {
    key: "wind",
    label: "Viento",
    url: "https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png",
    opacity: 0.65,
    zIndex: 490,
  },
];

const spainCenter: [number, number] = [40.4168, -3.7038];

const markerIcon = L.icon({
  iconUrl:
    "data:image/svg+xml;charset=UTF-8," +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="48" viewBox="0 0 32 48">
        <path fill="#d92d20" d="M16 0C7.163 0 0 7.163 0 16c0 12 16 32 16 32s16-20 16-32C32 7.163 24.837 0 16 0z"/>
        <circle cx="16" cy="16" r="7" fill="#fff"/>
      </svg>
    `),
  iconSize: [32, 48],
  iconAnchor: [16, 48],
  popupAnchor: [0, -40],
});

function ClickHandler({
  onSelect,
}: {
  onSelect: (coordinates: Coordinates) => void;
}) {
  useMapEvents({
    click(event) {
      onSelect({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

function RecenterMap({
  center,
  zoom,
}: {
  center: [number, number];
  zoom: number;
}) {
  const map = useMap();

  map.setView(center, zoom);

  return null;
}

function WeatherPane() {
  const map = useMap();

  if (!map.getPane("weather-overlay")) {
    const pane = map.createPane("weather-overlay");
    pane.style.zIndex = "450";
  }

  return null;
}

function buildWeatherLayerUrl(url: string, apiKey: string) {
  const searchParams = new URLSearchParams({
    appid: apiKey,
  });

  return `${url}?${searchParams.toString()}`;
}

function ReportSection({
  title,
  children,
}: {
  title: string;
  children: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
        {children}
      </p>
    </div>
  );
}

export default function SpainMap() {
  const [query, setQuery] = useState("");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(spainCenter);
  const [mapZoom, setMapZoom] = useState(6);
  const [loading, setLoading] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [error, setError] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [pdfError, setPdfError] = useState("");
  const [report, setReport] = useState<AreaReport | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [mapMode, setMapMode] = useState<MapMode>("street");

  const weatherApiKey = process.env.NEXT_PUBLIC_WEATHER_API_KEY ?? "";

  const markerPosition = useMemo<[number, number] | null>(() => {
    if (!coordinates) {
      return null;
    }

    return [coordinates.lat, coordinates.lng];
  }, [coordinates]);

  const weatherLayerUrls = useMemo(() => {
    if (!weatherApiKey) {
      return [];
    }

    return WEATHER_LAYERS.flatMap((layerConfig) => {
      if (!filters[layerConfig.key]) {
        return [];
      }

      return [
        {
          ...layerConfig,
          url: buildWeatherLayerUrl(layerConfig.url, weatherApiKey),
        },
      ];
    });
  }, [filters, weatherApiKey]);

  const handleMapSelection = (nextCoordinates: Coordinates) => {
    setCoordinates(nextCoordinates);
    setMapCenter([nextCoordinates.lat, nextCoordinates.lng]);
    setMapZoom(10);
    setSelectedName("");
    setError("");
    setAnalysisError("");
    setPdfError("");
    setReport(null);
  };

  const handleSearch = async () => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Escribe una direccion antes de buscar.");
      toast.error("Escribe una direccion antes de buscar.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(trimmedQuery)}`,
      );

      const data = (await response.json()) as
        | GeocodeResponse
        | { error?: string };

      if (!response.ok || !("lat" in data) || !("lon" in data)) {
        const nextError =
          "error" in data && typeof data.error === "string"
            ? data.error
            : "No se pudo geocodificar la direccion.";
        setError(nextError);
        toast.error(nextError);
        return;
      }

      const nextCoordinates = {
        lat: data.lat,
        lng: data.lon,
      };

      setCoordinates(nextCoordinates);
      setMapCenter([data.lat, data.lon]);
      setMapZoom(13);
      setSelectedName(data.name || data.display_name);
      setAnalysisError("");
      setPdfError("");
      setReport(null);
      toast.success("Direccion localizada en el mapa.");
    } catch {
      setError("Ha ocurrido un error al buscar la direccion.");
      toast.error("Ha ocurrido un error al buscar la direccion.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeArea = async () => {
    if (!coordinates) {
      return;
    }

    setAnalysisLoading(true);
    setAnalysisError("");
    setPdfError("");
    setReport(null);

    try {
      const response = await fetch("/api/analyze-area", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          lat: coordinates.lat,
          lon: coordinates.lng,
        }),
      });

      const data = (await response.json()) as AreaReport;

      if (!response.ok) {
        const nextError =
          typeof data.error === "string"
            ? data.error
            : "No se pudo analizar la zona.";
        setAnalysisError(nextError);
        toast.error(nextError);
        return;
      }

      setReport(data);
      toast.success("Informe generado.");
    } catch {
      setAnalysisError("Ha ocurrido un error al analizar la zona.");
      toast.error("Ha ocurrido un error al analizar la zona.");
    } finally {
      setAnalysisLoading(false);
    }
  };

  const getLocationLabel = () => {
    if (selectedName) {
      return selectedName;
    }

    if (coordinates) {
      return `${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`;
    }

    return "Ubicacion seleccionada";
  };

  const handleExportPdf = async () => {
    if (!report) {
      return;
    }

    setPdfLoading(true);
    setPdfError("");

    try {
      const response = await fetch("/api/export-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...report,
          locationLabel: getLocationLabel(),
        }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        const nextError = data.error ?? "No se pudo generar el PDF.";
        setPdfError(nextError);
        toast.error(nextError);
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "informe.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success("PDF descargado.");
    } catch {
      setPdfError("Ha ocurrido un error al exportar el PDF.");
      toast.error("Ha ocurrido un error al exportar el PDF.");
    } finally {
      setPdfLoading(false);
    }
  };

  const toggleFilter = (key: keyof Filters) => {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  return (
    <TooltipProvider>
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 overflow-hidden rounded-[32px] border border-white/70 bg-white/82 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur sm:p-8">
        <Card className="border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(236,253,245,0.96))]">
          <CardHeader className="gap-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-50 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-800"
              >
                Spain Weather Atlas
              </Badge>
              <CardTitle className="mt-4 font-[family-name:var(--font-fraunces)] text-4xl tracking-tight text-slate-950 sm:text-5xl">
                Busca una direccion o haz click en el mapa de Espana
              </CardTitle>
              <CardDescription className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
                Puedes escribir una direccion para centrar el mapa y colocar un
                marcador, o seleccionar una ubicacion manualmente con un click.
              </CardDescription>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
              <div className="rounded-lg border border-emerald-100 bg-white/80 p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Capa base
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  OpenStreetMap / Satelite
                </p>
              </div>
              <div className="rounded-lg border border-cyan-100 bg-white/80 p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Estado
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900">
                  Capas dinamicas
                </p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
            <Input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ejemplo: Barcelona, Espana"
              className="h-12 rounded-lg bg-slate-50"
            />
            <Button
              type="button"
              onClick={handleSearch}
              disabled={loading}
              className="h-12 rounded-lg px-5"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Search />}
              {loading ? "Buscando..." : "Buscar direccion"}
            </Button>
          </CardContent>
        </Card>

        <Card className="border-emerald-200/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.92),rgba(255,255,255,0.96))]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-[0.24em] text-emerald-800">
              <Layers className="size-4" />
              Capas de clima
            </CardTitle>
            <CardDescription className="text-emerald-950/70">
              Activa capas simples y combina filtros desde un solo estado
              tipado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              {WEATHER_LAYERS.map((layer) => (
                <Label
                  key={layer.key}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50"
                >
                  <Checkbox
                    checked={Boolean(filters[layer.key])}
                    onCheckedChange={() => toggleFilter(layer.key)}
                    className="size-5"
                  />
                  {layer.label}
                </Label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {WEATHER_LAYERS.filter((layer) => filters[layer.key]).map(
                (layer) => (
                  <Badge
                    key={layer.key}
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-900"
                  >
                    {layer.label} activa
                  </Badge>
                ),
              )}
            </div>
          </CardContent>
        </Card>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="overflow-hidden">
          <CardHeader className="gap-3 border-b border-slate-200 bg-white sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-sm uppercase tracking-[0.22em] text-slate-500">
                Vista del mapa
              </CardTitle>
              <CardDescription>
                Cambia entre cartografia base y vista satelite.
              </CardDescription>
            </div>
            <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1 text-sm font-semibold">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={mapMode === "street" ? "secondary" : "ghost"}
                    onClick={() => setMapMode("street")}
                    className="rounded-md"
                  >
                    <MapIcon />
                    Mapa
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ver cartografia de OpenStreetMap</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={mapMode === "satellite" ? "secondary" : "ghost"}
                    onClick={() => setMapMode("satellite")}
                    className="rounded-md"
                  >
                    <Satellite />
                    Satelite
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Ver imagen satelital con etiquetas</TooltipContent>
              </Tooltip>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <MapContainer
              center={spainCenter}
              zoom={6}
              scrollWheelZoom
              className="h-[440px] w-full sm:h-[560px]"
            >
              <WeatherPane />
              {mapMode === "satellite" ? (
                <TileLayer
                  attribution='Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                />
              ) : (
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
              )}
              {mapMode === "satellite" ? (
                <TileLayer
                  attribution='Labels &copy; Esri'
                  url="https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
                  zIndex={420}
                />
              ) : null}
              {weatherLayerUrls.map((layerConfig) => (
                <TileLayer
                  key={layerConfig.key}
                  attribution='&copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>'
                  url={layerConfig.url}
                  opacity={layerConfig.opacity}
                  pane="weather-overlay"
                  zIndex={layerConfig.zIndex}
                />
              ))}
              <RecenterMap center={mapCenter} zoom={mapZoom} />
              <ClickHandler onSelect={handleMapSelection} />
              {markerPosition ? (
                <Marker position={markerPosition} icon={markerIcon} />
              ) : null}
            </MapContainer>
          </CardContent>
        </Card>

        {!weatherApiKey ? (
          <Alert>
            <AlertDescription>
              Falta configurar <code>NEXT_PUBLIC_WEATHER_API_KEY</code> para
              ver las capas de OpenWeatherMap.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card className="bg-slate-950 text-slate-50">
          <CardContent className="p-5">
            {coordinates ? (
              <div className="flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:text-base">
                <div className="flex flex-col gap-1">
                  {selectedName ? (
                    <p className="font-medium text-white">{selectedName}</p>
                  ) : null}
                  <p>
                    Latitud: {coordinates.lat.toFixed(6)} | Longitud:{" "}
                    {coordinates.lng.toFixed(6)}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={handleAnalyzeArea}
                  disabled={analysisLoading}
                  className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                >
                  {analysisLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <MapPin />
                  )}
                  {analysisLoading ? "Analizando..." : "Analizar zona"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-4 text-sm sm:flex-row sm:items-center sm:justify-between sm:text-base">
                <p>
                  Todavia no hay coordenadas seleccionadas. Busca una direccion
                  o haz click en el mapa para elegir una ubicacion.
                </p>
                <Button type="button" disabled variant="secondary">
                  <MapPin />
                  Analizar zona
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {analysisLoading ? (
          <Alert className="border-emerald-200 bg-emerald-50 text-emerald-900">
            <Loader2 className="mr-2 inline size-4 animate-spin" />
            <AlertDescription className="inline">Analizando...</AlertDescription>
          </Alert>
        ) : null}

        {analysisError ? (
          <Alert variant="destructive">
            <AlertDescription>{analysisError}</AlertDescription>
          </Alert>
        ) : null}

        {pdfError ? (
          <Alert variant="destructive">
            <AlertDescription>{pdfError}</AlertDescription>
          </Alert>
        ) : null}

        {report ? (
          <Card>
            <CardHeader className="gap-3 border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-xl text-slate-950">
                  Informe geoespacial
                </CardTitle>
                <CardDescription>{getLocationLabel()}</CardDescription>
              </div>
              <Button
                type="button"
                onClick={handleExportPdf}
                disabled={pdfLoading}
              >
                {pdfLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Download />
                )}
                {pdfLoading ? "Generando PDF..." : "Descargar PDF"}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-4 p-5 md:grid-cols-2">
              <ReportSection title="Descripcion">
                {report.description}
              </ReportSection>
              <ReportSection title="Infraestructura">
                {report.infrastructure}
              </ReportSection>
              <ReportSection title="Riesgos">{report.risks}</ReportSection>
              <ReportSection title="Usos urbanos">
                {report.urbanUses}
              </ReportSection>
              <ReportSection title="Recomendacion">
                {report.recommendation}
              </ReportSection>
              <ReportSection title="Limitaciones">
                {report.limitations}
              </ReportSection>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </TooltipProvider>
  );
}
