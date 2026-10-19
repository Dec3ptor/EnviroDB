// The map: Leaflet with LINZ aerial imagery, streets and topographic maps (as PivotMap), the project's monitoring
// sites as labelled pins in their graph colours, and a pin for a point picked by clicking.

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { LINZ_BASEMAPS_KEY } from './linz';
const NEW_ZEALAND: L.LatLngBoundsExpression = [
  [-47.4, 166.3],
  [-34.3, 178.6],
];
const BASE_KEY = 'edb.map.base';

export interface MapSite {
  id: string;
  code: string;
  name?: string;
  color: string;
  lat: number;
  lng: number;
}

export interface SiteMapHandle {
  /** Go to a point (closer in than now, never further out). */
  flyTo(lat: number, lng: number, zoom?: number): void;
  /** Fit an area, e.g. a place found by search. */
  fitBounds(south: number, west: number, north: number, east: number): void;
  /** Fit all the sites in view. */
  fitSites(): void;
}

interface Props {
  sites: MapSite[];
  selectedId?: string | null;
  /** The point picked by clicking the map (or typed), shown as a pin. */
  pick?: { lat: number; lng: number } | null;
  /** Clicks place something: a crosshair cursor. */
  picking?: boolean;
  draggable?: boolean;
  onSiteClick?: (id: string) => void;
  onSiteMove?: (id: string, lat: number, lng: number) => void;
  onMapClick?: (lat: number, lng: number) => void;
}

function baseLayers(): Record<string, L.Layer> {
  const linz = '<a href="https://www.linz.govt.nz/data/linz-data/linz-basemaps/data-attribution" target="_blank" rel="noreferrer">LINZ CC BY 4.0</a> © Imagery Basemap contributors';
  const aerial = () => L.tileLayer(`https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/{z}/{x}/{y}.webp?api=${LINZ_BASEMAPS_KEY}`, { attribution: linz, maxNativeZoom: 19, maxZoom: 21 });
  return {
    'Aerial + labels': L.layerGroup([aerial(), L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', { attribution: '© CARTO', maxNativeZoom: 19, maxZoom: 21, pane: 'shadowPane' })]),
    Aerial: aerial(),
    Streets: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxNativeZoom: 19, maxZoom: 21 }),
    Topographic: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors', maxNativeZoom: 17, maxZoom: 21 }),
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function pinIcon(s: MapSite, selected: boolean): L.DivIcon {
  return L.divIcon({
    className: 'edb-pin',
    html: `<span class="edb-pin-dot${selected ? ' sel' : ''}" style="background:${s.color}"></span><span class="edb-pin-label${selected ? ' sel' : ''}">${esc(s.code)}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

const pickIcon = L.divIcon({ className: 'edb-pick', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 13] });

function readBase(): string {
  try {
    return localStorage.getItem(BASE_KEY) ?? 'Aerial + labels';
  } catch {
    return 'Aerial + labels';
  }
}

export const SiteMap = forwardRef<SiteMapHandle, Props>(function SiteMap(props, ref) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pinsRef = useRef<L.LayerGroup | null>(null);
  const pickRef = useRef<L.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  const fitSites = () => {
    const map = mapRef.current;
    const sites = latest.current.sites;
    if (!map) return;
    if (!sites.length) map.fitBounds(NEW_ZEALAND);
    else if (sites.length === 1) map.setView([sites[0].lat, sites[0].lng], 16);
    else map.fitBounds(L.latLngBounds(sites.map((s) => [s.lat, s.lng] as L.LatLngTuple)), { padding: [48, 48], maxZoom: 17 });
  };

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom) {
      const map = mapRef.current;
      if (map) map.setView([lat, lng], Math.max(map.getZoom(), zoom ?? 16));
    },
    fitBounds(south, west, north, east) {
      mapRef.current?.fitBounds([
        [south, west],
        [north, east],
      ], { maxZoom: 17 });
    },
    fitSites,
  }));

  // the map, once
  useEffect(() => {
    if (!el.current) return;
    const map = L.map(el.current, { minZoom: 4, maxZoom: 21, zoomControl: true, worldCopyJump: true });
    mapRef.current = map;
    const layers = baseLayers();
    const chosen = layers[readBase()] ? readBase() : 'Aerial + labels';
    layers[chosen].addTo(map);
    L.control.layers(layers, undefined, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    map.on('baselayerchange', (e: L.LayersControlEvent) => {
      try {
        localStorage.setItem(BASE_KEY, e.name);
      } catch {
        /* not remembered */
      }
    });
    map.on('click', (e: L.LeafletMouseEvent) => latest.current.onMapClick?.(e.latlng.lat, e.latlng.lng));
    pinsRef.current = L.layerGroup().addTo(map);
    fitSites();
    // the panel beside it changes size (window, phone rotation): keep the tiles filling it
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the sites' pins
  const key = JSON.stringify([props.sites.map((s) => [s.id, s.code, s.color, s.lat, s.lng]), props.selectedId, props.draggable]);
  useEffect(() => {
    const pins = pinsRef.current;
    if (!pins) return;
    pins.clearLayers();
    for (const s of props.sites) {
      const selected = s.id === props.selectedId;
      const m = L.marker([s.lat, s.lng], { icon: pinIcon(s, selected), draggable: !!props.draggable, title: s.name ? `${s.code} – ${s.name}` : s.code, riseOnHover: true, zIndexOffset: selected ? 1000 : 0, autoPan: true });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        latest.current.onSiteClick?.(s.id);
      });
      m.on('dragend', () => {
        const p = m.getLatLng();
        latest.current.onSiteMove?.(s.id, p.lat, p.lng);
      });
      pins.addLayer(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // the picked point
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    pickRef.current?.remove();
    pickRef.current = props.pick ? L.marker([props.pick.lat, props.pick.lng], { icon: pickIcon, interactive: false, keyboard: false }).addTo(map) : null;
  }, [props.pick?.lat, props.pick?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaflet adds its own classes to the map's element, so the class React sets lives on a wrapper
  return (
    <div className={`edb-map-wrap${props.picking ? ' edb-picking' : ''}`}>
      <div ref={el} className="edb-map" role="application" aria-label="Map of the monitoring sites" />
    </div>
  );
});
