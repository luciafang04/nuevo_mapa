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

export default function SpainMap() {
  const [query, setQuery] = useState("");
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [mapCenter, setMapCenter] = useState<[number, number]>(spainCenter);
  const [mapZoom, setMapZoom] = useState(6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [showTemperature, setShowTemperature] = useState(false);
  const [showPrecipitation, setShowPrecipitation] = useState(false);

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

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 rounded-[28px] border border-black/10 bg-white/90 p-5 shadow-lg shadow-black/5 backdrop-blur sm:p-8">
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
          Leaflet Demo
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Busca una direccion o haz click en el mapa de Espana
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">
          Puedes escribir una direccion para centrar el mapa y colocar un
          marcador, o seleccionar una ubicacion manualmente con un click.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ejemplo: Barcelona, Espana"
          className="min-w-0 flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={loading}
          className="rounded-2xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-emerald-300"
        >
          {loading ? "Buscando..." : "Buscar direccion"}
        </button>
      </div>

      <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm shadow-emerald-100">
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-800">
              Capas de clima
            </span>
            <p className="text-sm text-emerald-900/80">
              Activa las capas encima del mapa base de OpenStreetMap.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
            <input
              type="checkbox"
              checked={showTemperature}
              onChange={(event) => setShowTemperature(event.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
            />
            Temperatura
          </label>
          <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50">
            <input
              type="checkbox"
              checked={showPrecipitation}
              onChange={(event) => setShowPrecipitation(event.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-emerald-600 accent-emerald-600 focus:ring-emerald-500"
            />
            Precipitaciones
          </label>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-slate-200">
        <MapContainer
          center={spainCenter}
          zoom={6}
          scrollWheelZoom
          className="h-[420px] w-full sm:h-[520px]"
        >
          <WeatherPane />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {weatherApiKey && showTemperature ? (
            <TileLayer
              attribution='&copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>'
              url={`https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${weatherApiKey}`}
              opacity={0.85}
              pane="weather-overlay"
              zIndex={460}
            />
          ) : null}
          {weatherApiKey && showPrecipitation ? (
            <TileLayer
              attribution='&copy; <a href="https://openweathermap.org/">OpenWeatherMap</a>'
              url={`https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${weatherApiKey}`}
              opacity={0.85}
              pane="weather-overlay"
              zIndex={470}
            />
          ) : null}
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

      <div className="rounded-2xl bg-slate-900 px-5 py-4 text-slate-50">
        {coordinates ? (
          <div className="flex flex-col gap-1 text-sm sm:text-base">
            {selectedName ? <p>Resultado: {selectedName}</p> : null}
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
