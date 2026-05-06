"use client";

import { useMemo, useState } from "react";
import L from "leaflet";
import {
  Download,
  CircleHelp,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
      <h3 className="font-title text-sm font-semibold text-black">{title}</h3>
      <p className="mt-2 whitespace-pre-line text-sm leading-6 text-black/80">
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
      <section className="flex min-h-[100dvh] w-full flex-col gap-4 overflow-visible p-0 sm:p-1 lg:min-h-0 lg:h-full lg:overflow-hidden">
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex min-h-0 flex-col gap-4 overflow-visible lg:overflow-hidden">
            <Card className="border-slate-200/70 bg-white">
              <CardHeader className="gap-3 p-4">
                <CardTitle className="text-2xl font-bold tracking-tight text-black opacity-100">
                  Explora el mapa
                </CardTitle>
                <CardDescription className="text-sm font-medium leading-6 text-black opacity-100">
                  Busca una dirección o haz clic en el mapa para ver la zona
                  con más calma.
                </CardDescription>
              </CardHeader>
            </Card>

            <div className="min-h-0 space-y-4 overflow-visible pr-1 lg:overflow-y-auto">
              <Card>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="space-y-2">
                    <p className="font-title text-lg font-semibold tracking-[0.02em] text-black">
                      Buscar por dirección:
                    </p>
                    <div className="flex items-end gap-2">
                      <Input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Ejemplo: Barcelona, Espana"
                        className="h-10 flex-1 rounded-none border-0 border-b border-slate-300 bg-white px-0 text-base text-black shadow-none ring-0 placeholder:text-black/40 focus-visible:border-orange-500 focus-visible:ring-0"
                      />
                      <Button
                        type="button"
                        onClick={handleSearch}
                        disabled={loading}
                        aria-label="Buscar dirección"
                        className="size-10 shrink-0 rounded-full bg-white p-0 text-black hover:bg-white/90"
                      >
                        {loading ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          <Search />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/70 bg-white">
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-[0.02em] text-black">
                    <Layers className="size-4" />
                    Filtros
                  </CardTitle>
                  <CardDescription className="text-xs leading-5 text-black">
                    Pruébame
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {WEATHER_LAYERS.map((layer) => (
                      <Label
                        key={layer.key}
                        className="cursor-pointer rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-black transition hover:border-orange-300 hover:bg-orange-50 sm:text-sm"
                      >
                        <Checkbox
                          checked={Boolean(filters[layer.key])}
                          onCheckedChange={() => toggleFilter(layer.key)}
                          className="size-4 shrink-0"
                        />
                        {layer.label}
                      </Label>
                    ))}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {WEATHER_LAYERS.filter((layer) => filters[layer.key]).map(
                      (layer) => (
                        <Badge
                          key={layer.key}
                          variant="secondary"
                        className="bg-orange-100 text-black"
                        >
                          {layer.label}
                        </Badge>
                      ),
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-slate-200/70 bg-white text-black">
                <CardContent className="p-4">
                  {coordinates ? (
                    <div className="flex flex-col gap-3">
                      <div className="space-y-1 text-sm">
                        {selectedName ? (
                          <p className="font-medium text-black">{selectedName}</p>
                        ) : null}
                        <p className="text-black">
                          {coordinates.lat.toFixed(6)} |{" "}
                          {coordinates.lng.toFixed(6)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        onClick={handleAnalyzeArea}
                        disabled={analysisLoading}
                        className="border border-orange-200 bg-orange-300 text-black hover:bg-orange-200"
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
                    <div className="flex flex-col gap-3 text-sm">
                      <p className="text-black">
                        Busca una direccion o haz click en el mapa para elegir
                        una ubicacion.
                      </p>
                      <Button type="button" disabled variant="secondary">
                        <MapPin />
                        Analizar zona
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-slate-200/70 bg-white text-black">
                <CardHeader className="p-4 pb-3">
                  <CardTitle className="text-lg font-semibold tracking-[0.02em] text-black">
                    Manual de uso
                  </CardTitle>
                  <CardDescription className="text-sm text-black">
                    Abre esta guía rápida cuando quieras repasar los pasos.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-10 w-full border-orange-200 bg-orange-100 text-black hover:bg-orange-50"
                      >
                        <CircleHelp />
                        Ver manual
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80">
                      <div className="space-y-3">
                        <div>
                          <h4 className="font-title text-base font-semibold text-black">
                            Cómo usar el mapa
                          </h4>
                        </div>
                        <ol className="space-y-2 text-sm text-black">
                          <li>1. Escribe una dirección o haz clic en el mapa.</li>
                          <li>2. Activa los filtros que quieras comparar.</li>
                          <li>3. Pulsa “Analizar zona” para ver el informe.</li>
                          <li>4. Descarga el PDF si quieres guardarlo.</li>
                        </ol>
                      </div>
                    </PopoverContent>
                  </Popover>
                </CardContent>
              </Card>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {!weatherApiKey ? (
                <Alert>
                  <AlertDescription>
                    Falta configurar <code>NEXT_PUBLIC_WEATHER_API_KEY</code>{" "}
                    para ver las capas de OpenWeatherMap.
                  </AlertDescription>
                </Alert>
              ) : null}

              {analysisLoading ? (
                <Alert className="border-orange-200 bg-orange-50 text-black">
                  <Loader2 className="mr-2 inline size-4 animate-spin" />
                  <AlertDescription className="inline">
                    Analizando...
                  </AlertDescription>
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
            </div>
          </aside>

          <div className="flex min-h-0 flex-col gap-4 overflow-visible lg:overflow-hidden">
            <Card className="min-h-0 overflow-hidden border-slate-200 bg-white">
              <CardHeader className="flex-row items-center justify-between gap-3 border-b border-slate-200 bg-white p-4">
                <div>
                  <CardTitle className="text-lg font-semibold tracking-[0.02em] text-black">
                    Vista del mapa
                  </CardTitle>
                </div>
                <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1 text-sm font-semibold">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setMapMode("street")}
                        className={
                          mapMode === "street"
                            ? "rounded-md bg-orange-300 px-3 text-black hover:bg-orange-200"
                            : "rounded-md px-3 text-black hover:bg-slate-200"
                        }
                      >
                        <MapIcon />
                        Mapa
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Ver cartografía de OpenStreetMap</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setMapMode("satellite")}
                        className={
                          mapMode === "satellite"
                            ? "rounded-md bg-orange-300 px-3 text-black hover:bg-orange-200"
                            : "rounded-md px-3 text-black hover:bg-slate-200"
                        }
                      >
                        <Satellite />
                        Satélite
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      Ver imagen satelital con etiquetas
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <MapContainer
                  center={spainCenter}
                  zoom={6}
                  scrollWheelZoom
                  className="h-[38vh] min-h-[280px] w-full lg:h-[46vh]"
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
                      attribution="Labels &copy; Esri"
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

            {report ? (
              <Card className="min-h-0 flex-1 overflow-hidden border-slate-200 bg-white">
                <CardHeader className="flex-row items-center justify-between gap-3 border-b border-slate-200 p-4">
                  <div>
                    <CardTitle className="text-lg text-black">
                      Informe geoespacial
                    </CardTitle>
                    <CardDescription>{getLocationLabel()}</CardDescription>
                  </div>
                  <Button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={pdfLoading}
                    className="border border-orange-200 bg-orange-300 text-black hover:bg-orange-200"
                  >
                    {pdfLoading ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Download />
                    )}
                    {pdfLoading ? "Generando PDF..." : "Descargar PDF"}
                  </Button>
                </CardHeader>
                <CardContent className="grid gap-3 p-4 md:grid-cols-2 lg:max-h-[28vh] lg:overflow-y-auto">
                  <ReportSection title="Descripción">
                    {report.description}
                  </ReportSection>
                  <ReportSection title="Infraestructura">
                    {report.infrastructure}
                  </ReportSection>
                  <ReportSection title="Riesgos">{report.risks}</ReportSection>
                  <ReportSection title="Usos urbanos">
                    {report.urbanUses}
                  </ReportSection>
                  <ReportSection title="Recomendación">
                    {report.recommendation}
                  </ReportSection>
                  <ReportSection title="Limitaciones">
                    {report.limitations}
                  </ReportSection>
                </CardContent>
              </Card>
            ) : (
              <Card className="flex-1 items-center justify-center">
                <CardContent className="flex h-full min-h-[18vh] flex-col items-start justify-center p-4">
                  <p className="text-sm text-black">
                    Cuando analices una zona, el informe aparecerá aquí sin
                    desplazar la página.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>
    </TooltipProvider>
  );
}
