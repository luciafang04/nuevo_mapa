"use client";

import { useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

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

type WeatherLayerConfig = {
  key: keyof Filters;
  label: string;
  url: string;
  opacity: number;
  zIndex: number;
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

export default function SpainMap() {
  const [query, setQuery] = useState("");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(spainCenter);
  const [mapZoom, setMapZoom] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  const weatherApiKey = process.env.NEXT_PUBLIC_WEATHER_API_KEY ?? "";

  const markerPosition = useMemo<[number, number] | null>(() => {
    if (!coordinates) {
      return null;
    }

    return [coordinates.lat, coordinates.lng];
  }, [coordinates]);

  const handleMapSelection = (nextCoordinates: Coordinates) => {
    setCoordinates(nextCoordinates);
    setMapCenter([nextCoordinates.lat, nextCoordinates.lng]);
    setMapZoom(10);
    setSelectedName("");
    setError("");
  };

  const handleSearch = async () => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setError("Escribe una direccion antes de buscar.");
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
    } catch {
      setError("Ha ocurrido un error al buscar la direccion.");
    } finally {
      setLoading(false);
    }
  };

  const toggleFilter = (key: keyof Filters) => {
    setFilters((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

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

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-7 overflow-hidden rounded-[32px] border border-white/70 bg-white/82 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.14)] backdrop-blur sm:p-8">
      <div className="rounded-[28px] border border-slate-200/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(236,253,245,0.96))] p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-800">
              Spain Weather Atlas
            </span>
            <h1 className="mt-4 font-[family-name:var(--font-fraunces)] text-4xl tracking-tight text-slate-950 sm:text-5xl">
          Busca una direccion o haz click en el mapa de Espana
        </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
              Puedes escribir una direccion para centrar el mapa y colocar un
              marcador, o seleccionar una ubicacion manualmente con un click.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[320px]">
            <div className="rounded-3xl border border-emerald-100 bg-white/80 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Capa base
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                OpenStreetMap
              </p>
            </div>
            <div className="rounded-3xl border border-cyan-100 bg-white/80 p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Estado
              </p>
              <p className="mt-2 text-sm font-medium text-slate-900">
                Capas dinámicas
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200/80 bg-white/85 p-4 shadow-sm sm:flex-row sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ejemplo: Barcelona, Espana"
          className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="rounded-2xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {loading ? "Buscando..." : "Buscar direccion"}
        </button>
      </div>

      <div className="rounded-[28px] border border-emerald-200/70 bg-[linear-gradient(180deg,rgba(236,253,245,0.92),rgba(255,255,255,0.96))] p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-800">
              Capas de clima
            </span>
            <p className="mt-1 text-sm text-emerald-950/70">
              Activa capas simples y combina filtros desde un solo estado
              tipado.
            </p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
              Capas activas
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-100">
                <input
                  type="checkbox"
                  checked={Boolean(filters.temperature)}
                  onChange={() => toggleFilter("temperature")}
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
                />
                Temperatura
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-100">
                <input
                  type="checkbox"
                  checked={Boolean(filters.precipitation)}
                  onChange={() => toggleFilter("precipitation")}
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
                />
                Precipitaciones
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-100">
                <input
                  type="checkbox"
                  checked={Boolean(filters.humidity)}
                  onChange={() => toggleFilter("humidity")}
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
                />
                Humedad
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-100">
                <input
                  type="checkbox"
                  checked={Boolean(filters.wind)}
                  onChange={() => toggleFilter("wind")}
                  className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
                />
                Viento
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-700">
          {filters.temperature ? (
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-medium text-emerald-900">
              Temperatura activa
            </span>
          ) : null}
          {filters.precipitation ? (
            <span className="rounded-full bg-cyan-100 px-3 py-1 font-medium text-cyan-900">
              Precipitaciones activas
            </span>
          ) : null}
          {filters.humidity ? (
            <span className="rounded-full bg-slate-200 px-3 py-1 font-medium text-slate-800">
              Humedad activa
            </span>
          ) : null}
          {filters.wind ? (
            <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-900">
              Viento activo
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[32px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.14)]">
        <MapContainer
          center={spainCenter}
          zoom={6}
          scrollWheelZoom
          className="h-[440px] w-full sm:h-[560px]"
        >
          <WeatherPane />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
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
      </div>

      {!weatherApiKey ? (
        <p className="text-sm text-amber-700">
          Falta configurar <code>NEXT_PUBLIC_WEATHER_API_KEY</code> para ver
          las capas de OpenWeatherMap.
        </p>
      ) : null}

      <div className="rounded-[24px] bg-slate-950 px-5 py-4 text-slate-50 shadow-sm">
        {coordinates ? (
          <div className="flex flex-col gap-1 text-sm sm:text-base">
            {selectedName ? (
              <p className="font-medium text-white">{selectedName}</p>
            ) : null}
            <p>
              Latitud: {coordinates.lat.toFixed(6)} | Longitud:{" "}
              {coordinates.lng.toFixed(6)}
            </p>
          </div>
        ) : (
          <p className="text-sm sm:text-base">
            Todavia no hay coordenadas seleccionadas. Busca una direccion o haz
            click en el mapa para elegir una ubicacion.
          </p>
        )}
      </div>
    </section>
  );
}
