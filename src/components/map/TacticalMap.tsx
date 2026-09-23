import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatLike, StyleSpecification, MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SEVERITY_META, unitDesignator } from "@/lib/doip";
import { simStore } from "@/sim/store";
import { isStale } from "@/sim/reducer";
import type { Incident, Unit, WeatherCell, Zone } from "@/sim/types";
import { Compass, Box, Square } from "lucide-react";
import type { Feature, FeatureCollection } from "geojson";

export const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
export const ATTRIBUTION = "© OpenStreetMap contributors © CARTO";

export type Basemap = "imagery" | "dark";
const BASEMAP_KEY = "doip.basemap";

const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const CARTO_LABELS = [
  "https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png".replace("{r}", ""),
  "https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png",
  "https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png",
];

/** Satellite imagery, darkened + desaturated in-canvas so markers stay full-brightness. */
const imageryStyle = (): StyleSpecification => ({
  version: 8,
  sources: {
    "esri-imagery": {
      type: "raster",
      tiles: [ESRI_TILES],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    },
    "carto-labels": {
      type: "raster",
      tiles: CARTO_LABELS,
      tileSize: 256,
      maxzoom: 20,
      attribution: "© OpenStreetMap contributors © CARTO",
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0A0A0A" } },
    {
      id: "esri-imagery-layer",
      type: "raster",
      source: "esri-imagery",
      paint: {
        // equivalent of a rgba(0,0,0,0.45) scrim + saturate(0.6), applied to tiles only
        "raster-opacity": 1,
        "raster-brightness-max": 0.55,
        "raster-saturation": -0.4,
        "raster-contrast": 0.05,
      },
    },
    {
      id: "carto-labels-layer",
      type: "raster",
      source: "carto-labels",
      paint: { "raster-opacity": 0.9 },
    },
  ],
});

const DEFAULT_PITCH = 55;
const DEFAULT_BEARING = -15;
const TRAIL_LEN = 20;

export interface TacticalMapProps {
  units?: Unit[];
  incidents?: Incident[];
  weather?: WeatherCell[];
  zones?: Zone[];
  tick?: number;
  center?: [number, number];
  zoom?: number;
  selectedId?: string | null;
  focus?: [number, number] | null;
  pulseAt?: [number, number] | null;
  waypoints?: Array<[number, number]>;
  routes?: Array<{ points: Array<[number, number]>; color: string; dashed?: boolean }>;
  cursors?: Array<{ id: string; name: string; color: string; lat: number; lon: number }>;
  radar?: boolean;
  onSelectUnit?: (id: string) => void;
  onSelectIncident?: (id: string) => void;
  onMapClick?: (latlng: [number, number]) => void;
  className?: string;
}

const unitColor = (u: Unit) => "#FFFFFF";

/** metres -> approximate degree ring polygon */
function ringPolygon(lat: number, lon: number, radiusM: number, steps = 40): number[][] {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  const pts: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push([lon + Math.cos(a) * dLon, lat + Math.sin(a) * dLat]);
  }
  return pts;
}

function fc(features: Feature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}

export default function TacticalMap({
  units = [],
  incidents = [],
  weather = [],
  zones = [],
  tick = 0,
  center = [12.9716, 77.5946],
  zoom = 12,
  selectedId,
  focus,
  pulseAt,
  waypoints = [],
  routes = [],
  cursors = [],
  radar = false,
  onSelectUnit,
  onSelectIncident,
  onMapClick,
  className,
}: TacticalMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [is3d, setIs3d] = useState(true);
  const [bearing, setBearing] = useState(DEFAULT_BEARING);
  const [basemap, setBasemap] = useState<Basemap>(() => {
    if (typeof window === "undefined") return "imagery";
    const v = window.localStorage.getItem(BASEMAP_KEY);
    return v === "dark" ? "dark" : "imagery";
  });
  const [tilesLoading, setTilesLoading] = useState(true);
  const trailsRef = useRef<Record<string, Array<[number, number]>>>({});
  const markersRef = useRef<Record<string, maplibregl.Marker>>({});
  const cbRef = useRef({ onSelectUnit, onSelectIncident, onMapClick });
  cbRef.current = { onSelectUnit, onSelectIncident, onMapClick };
  const radarRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);

  /* ---------- init (rebuilds when the basemap changes) ---------- */
  useEffect(() => {
    if (!containerRef.current) return;
    setReady(false);
    setTilesLoading(true);
    const saved = viewRef.current;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: basemap === "imagery" ? imageryStyle() : (STYLE_URL as unknown as StyleSpecification),
      center: (saved ? saved.center : [center[1], center[0]]) as LngLatLike,
      zoom: saved ? saved.zoom : zoom,
      pitch: DEFAULT_PITCH,
      bearing: DEFAULT_BEARING,
      // attribution comes from each source/style — never duplicated here
      attributionControl: { compact: false },
      dragRotate: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

    map.on("error", (e: { error?: { message?: string } }) =>
      console.warn("[map]", e?.error?.message ?? e),
    );
    const doneLoading = () => setTilesLoading(false);
    map.on("load", doneLoading);
    map.on("idle", doneLoading);
    const loadFallback = window.setTimeout(doneLoading, 4000);

    const initLayers = () => {
      // Basemap kept just off pure black so moving markers do not smear
      try {
        for (const l of map.getStyle().layers ?? []) {
          if (l.type === "background") map.setPaintProperty(l.id, "background-color", "#0A0A0A");
        }
      } catch {
        /* style not ready */
      }

      // 3D building extrusions (vector dark basemap only)
      if (basemap === "dark") {
        try {
          map.addLayer({
            id: "doip-buildings",
            type: "fill-extrusion",
            source: "carto",
            "source-layer": "building",
            minzoom: 12,
            paint: {
              "fill-extrusion-color": "#161616",
              "fill-extrusion-height": ["coalesce", ["get", "render_height"], 12],
              "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.9,
            },
          });
        } catch {
          /* style may not expose a building source-layer */
        }
      }

      const empty = fc([]);
      const src = (id: string, lineMetrics = false) =>
        map.addSource(id, { type: "geojson", data: empty, lineMetrics });

      src("zones");
      src("zone-lines");
      src("weather");
      src("incidents");
      src("routes");
      src("waypoints");
      src("trails", true);

      // Restricted / patrol zones -> extruded translucent walls
      map.addLayer({
        id: "zones-fill",
        type: "fill-extrusion",
        source: "zones",
        paint: {
          "fill-extrusion-color": ["get", "color"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.22,
        },
      });
      map.addLayer({
        id: "zones-outline",
        type: "line",
        source: "zone-lines",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.2,
          "line-opacity": 0.85,
          "line-dasharray": [2, 3],
        },
      });

      // Weather domes
      map.addLayer({
        id: "weather-dome",
        type: "fill-extrusion",
        source: "weather",
        paint: {
          "fill-extrusion-color": ["get", "rgba"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 1,
        },
      });

      // Motion trails
      map.addLayer({
        id: "unit-trails",
        type: "line",
        source: "trails",
        layout: { "line-cap": "round" },
        paint: {
          "line-width": 1.6,
          "line-color": ["get", "color"],
          "line-opacity": 0.55,
          "line-gradient": [
            "interpolate",
            ["linear"],
            ["line-progress"],
            0,
            "rgba(255,255,255,0)",
            1,
            "rgba(255,255,255,0.7)",
          ],
        },
      });

      // Planned routes
      map.addLayer({
        id: "routes-line",
        type: "line",
        source: "routes",
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2,
          "line-opacity": 0.9,
          "line-dasharray": [2, 2],
        },
      });

      // Incident ground rings
      map.addLayer({
        id: "incident-rings",
        type: "circle",
        source: "incidents",
        paint: {
          "circle-radius": ["get", "r"],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.06,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": 1.4,
          "circle-stroke-opacity": ["get", "op"],
        },
      });
      map.addLayer({
        id: "incident-core",
        type: "circle",
        source: "incidents",
        paint: {
          "circle-radius": 3.5,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.95,
        },
      });

      map.addLayer({
        id: "waypoint-dots",
        type: "circle",
        source: "waypoints",
        paint: {
          "circle-radius": 4,
          "circle-color": "#0A0A0A",
          "circle-stroke-color": "#FFFFFF",
          "circle-stroke-width": 2,
        },
      });

      map.on("click", "incident-core", (e: MapMouseEvent & { features?: Feature[] }) => {
        const id = e.features?.[0]?.properties?.["id"];
        if (id) cbRef.current.onSelectIncident?.(String(id));
      });
      map.on("mouseenter", "incident-core", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "incident-core", () => (map.getCanvas().style.cursor = ""));

      setReady(true);
    };
    map.on("style.load", initLayers);

    map.on("click", (e: MapMouseEvent) => cbRef.current.onMapClick?.([e.lngLat.lat, e.lngLat.lng]));
    map.on("rotate", () => setBearing(map.getBearing()));
    map.on("moveend", () => {
      const c = map.getCenter();
      viewRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
    });

    return () => {
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      Object.values(cursorMarkers.current).forEach((m) => m.remove());
      cursorMarkers.current = {};
      window.clearTimeout(loadFallback);
      map.remove();

      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* ---------- zones ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const color = (k: Zone["kind"]) =>
      k === "restricted" ? "#F87171" : k === "threat" ? "#FB923C" : "#8A8A8A";
    const polys = zones.map((z) => ({
      type: "Feature" as const,
      properties: { color: color(z.kind), height: z.kind === "restricted" ? 50 : 8, name: z.name },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [...z.points.map(([la, lo]) => [lo, la]), [z.points[0]![1], z.points[0]![0]]],
        ],
      },
    }));
    (map.getSource("zones") as maplibregl.GeoJSONSource | undefined)?.setData(fc(polys));
    (map.getSource("zone-lines") as maplibregl.GeoJSONSource | undefined)?.setData(
      fc(
        zones.map((z) => ({
          type: "Feature",
          properties: { color: color(z.kind) },
          geometry: {
            type: "LineString",
            coordinates: [
              ...z.points.map(([la, lo]) => [lo, la]),
              [z.points[0]![1], z.points[0]![0]],
            ],
          },
        })),
      ),
    );
  }, [zones, ready]);

  /* ---------- weather domes ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("weather") as maplibregl.GeoJSONSource | undefined)?.setData(
      fc(
        weather.map((w) => ({
          type: "Feature",
          properties: {
            height: 150 + w.intensity * 650,
            rgba: `rgba(100,116,139,${(0.25 + w.intensity * 0.15).toFixed(2)})`,
          },
          geometry: { type: "Polygon", coordinates: [ringPolygon(w.lat, w.lon, w.radiusM)] },
        })),
      ),
    );
  }, [weather, ready]);

  /* ---------- routes + waypoints ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource("routes") as maplibregl.GeoJSONSource | undefined)?.setData(
      fc(
        routes.map((r) => ({
          type: "Feature",
          properties: { color: r.color },
          geometry: { type: "LineString", coordinates: r.points.map(([la, lo]) => [lo, la]) },
        })),
      ),
    );
    (map.getSource("waypoints") as maplibregl.GeoJSONSource | undefined)?.setData(
      fc(
        waypoints.map((w, i) => ({
          type: "Feature",
          properties: { i: i + 1 },
          geometry: { type: "Point", coordinates: [w[1], w[0]] },
        })),
      ),
    );
  }, [routes, waypoints, ready]);

  /* ---------- incidents (animated rings) ---------- */
  const incidentsRef = useRef(incidents);
  incidentsRef.current = incidents;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let raf = 0;
    const start = performance.now();
    const frame = (t: number) => {
      const phase = ((t - start) / 2400) % 1;
      const src = map.getSource("incidents") as maplibregl.GeoJSONSource | undefined;
      src?.setData(
        fc(
          incidentsRef.current.map((inc) => {
            const critical = inc.severity === "critical";
            const p = critical ? phase : Math.min(1, (t - start) / 2400);
            return {
              type: "Feature",
              properties: {
                id: inc.id,
                color: SEVERITY_META[inc.severity].color,
                r: 8 + p * 26,
                op: Math.max(0, 0.75 * (1 - p)),
              },
              geometry: { type: "Point", coordinates: [inc.lon, inc.lat] },
            };
          }),
        ),
      );
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  /* ---------- units: DOM markers + trails ---------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    const personnel = simStore.getState().world.personnel;

    for (const u of units) {
      seen.add(u.id);
      const stale = isStale(u, tick);
      const color = unitColor(u);
      const trail = trailsRef.current[u.id] ?? (trailsRef.current[u.id] = []);
      const last = trail[trail.length - 1];
      if (!last || last[0] !== u.lon || last[1] !== u.lat) trail.push([u.lon, u.lat]);
      if (trail.length > TRAIL_LEN) trail.splice(0, trail.length - TRAIL_LEN);

      let marker = markersRef.current[u.id];
      if (!marker) {
        const el = document.createElement("div");
        el.className = "doip-unit-marker";
        el.innerHTML = `<span class="doip-unit-stem"></span><span class="doip-unit-shadow"></span><span class="doip-unit-dot"></span><span class="doip-unit-label"></span>`;
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cbRef.current.onSelectUnit?.(u.id);
        });
        marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([u.lon, u.lat])
          .addTo(map);
        markersRef.current[u.id] = marker;
      }
      marker.setLngLat([u.lon, u.lat]);
      const el = marker.getElement();
      const elevated = u.kind === "uav";
      el.classList.toggle("is-elevated", elevated);
      el.classList.toggle("is-stale", stale);
      el.classList.toggle("is-selected", selectedId === u.id);
      el.style.setProperty("--unit-color", color);
      const label = el.querySelector(".doip-unit-label");
      if (label) label.textContent = unitDesignator(u, personnel);
    }

    for (const id of Object.keys(markersRef.current)) {
      if (!seen.has(id)) {
        markersRef.current[id]?.remove();
        delete markersRef.current[id];
        delete trailsRef.current[id];
      }
    }

    (map.getSource("trails") as maplibregl.GeoJSONSource | undefined)?.setData(
      fc(
        Object.entries(trailsRef.current)
          .filter(([, pts]) => pts.length > 1)
          .map(([id, pts]) => ({
            type: "Feature",
            properties: { id, color: "#FFFFFF" },
            geometry: { type: "LineString", coordinates: pts },
          })),
      ),
    );
  }, [units, tick, selectedId, ready]);

  /* ---------- collaborator cursors ---------- */
  const cursorMarkers = useRef<Record<string, maplibregl.Marker>>({});
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const seen = new Set<string>();
    for (const c of cursors) {
      seen.add(c.id);
      let m = cursorMarkers.current[c.id];
      if (!m) {
        const el = document.createElement("div");
        el.className = "doip-cursor";
        el.innerHTML = `<span class="doip-cursor-dot"></span><span class="doip-cursor-name"></span>`;
        m = new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(map);
        cursorMarkers.current[c.id] = m;
      }
      m.setLngLat([c.lon, c.lat]);
      const el = m.getElement();
      el.style.setProperty("--cursor-color", c.color);
      const n = el.querySelector(".doip-cursor-name");
      if (n) n.textContent = c.name;
    }
    for (const id of Object.keys(cursorMarkers.current)) {
      if (!seen.has(id)) {
        cursorMarkers.current[id]?.remove();
        delete cursorMarkers.current[id];
      }
    }
  }, [cursors, ready]);

  /* ---------- focus / pulse flyTo ---------- */
  useEffect(() => {
    const map = mapRef.current;
    const target = focus ?? pulseAt;
    if (!map || !ready || !target) return;
    map.flyTo({
      center: [target[1], target[0]],
      zoom: Math.max(map.getZoom(), 13.5),
      pitch: is3d ? DEFAULT_PITCH : 0,
      duration: 1200,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, pulseAt, ready]);

  /* ---------- radar sweep anchor (imperative: avoids render loops) ---------- */
  const [clat, clon] = [center[0], center[1]];
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !radar) return;
    const update = () => {
      const el = radarRef.current;
      if (!el) return;
      const p = map.project([clon, clat]);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("resize", update);
    };
  }, [ready, radar, clat, clon]);

  const toggle3d = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = !is3d;
    setIs3d(next);
    map.easeTo({
      pitch: next ? DEFAULT_PITCH : 0,
      bearing: next ? DEFAULT_BEARING : 0,
      duration: 700,
    });
  }, [is3d]);

  const resetNorth = useCallback(() => {
    mapRef.current?.easeTo({ bearing: 0, duration: 500 });
  }, []);

  const pickBasemap = useCallback((b: Basemap) => {
    setBasemap((prev) => {
      if (prev === b) return prev;
      try {
        window.localStorage.setItem(BASEMAP_KEY, b);
      } catch {
        /* storage unavailable */
      }
      return b;
    });
  }, []);

  return (
    <div className={`relative h-full w-full ${className ?? ""}`} style={{ background: "#0A0A0A" }}>
      <div ref={containerRef} className="h-full w-full" />
      {radar && <div ref={radarRef} className="doip-radar-sweep" aria-hidden />}
      {tilesLoading && (
        <div className="pointer-events-none absolute left-3 bottom-3 z-10 font-mono text-[11px] uppercase tracking-[0.1em] text-[#8A8A8A]">
          Loading tiles
        </div>
      )}
      <div className="absolute right-2 top-16 z-10 flex flex-col items-end gap-1">
        <div className="flex border border-[#2A2A2A] bg-[rgba(13,13,13,0.82)] backdrop-blur-[16px]">
          {(["imagery", "dark"] as Basemap[]).map((b) => (
            <button
              key={b}
              onClick={() => pickBasemap(b)}
              className={`px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${
                basemap === b ? "bg-white text-black" : "text-[#8A8A8A]"
              }`}
            >
              {b === "imagery" ? "IMAGERY" : "DARK"}
            </button>
          ))}
        </div>
        <button
          onClick={resetNorth}
          title="Reset north"
          className="doip-map-btn"
          style={{ ["--compass-rot" as string]: `${-bearing}deg` }}
        >
          <Compass className="size-3.5" style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
        <button
          onClick={toggle3d}
          title={is3d ? "Switch to 2D" : "Switch to 3D"}
          className="doip-map-btn"
        >
          {is3d ? <Square className="size-3.5" /> : <Box className="size-3.5" />}
          <span className="font-mono text-[10px]">{is3d ? "2D" : "3D"}</span>
        </button>
      </div>
    </div>
  );
}
