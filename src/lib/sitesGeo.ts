// Monitoring sites as map files: GeoJSON (QGIS, ArcGIS) and KML (Google Earth). Coordinates are WGS84
// longitude/latitude as both formats require, with the NZTM easting/northing kept as attributes.

import type { Site } from '../db/types';
import { siteLatLng } from './nztm';

const round = (v: number) => Math.round(v * 1e7) / 1e7;

/** Sites with a location as a GeoJSON FeatureCollection. */
export function sitesGeoJson(sites: Site[], project: { name: string; code?: string }): string {
  const features = sites.flatMap((s) => {
    const p = siteLatLng(s);
    if (!p) return [];
    return [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [round(p.lng), round(p.lat)] },
        properties: {
          code: s.code,
          name: s.name ?? '',
          type: s.type,
          role: s.role || '',
          easting_nztm: s.easting,
          northing_nztm: s.northing,
          project: project.name,
          project_code: project.code ?? '',
          description: s.description ?? '',
        },
      },
    ];
  });
  return JSON.stringify({ type: 'FeatureCollection', name: project.name, features }, null, 2);
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Sites with a location as a KML document. */
export function sitesKml(sites: Site[], project: { name: string }): string {
  const marks = sites.flatMap((s) => {
    const p = siteLatLng(s);
    if (!p) return [];
    const about = [s.name, s.type, s.role, `NZTM ${s.easting} E, ${s.northing} N`, s.description].filter(Boolean).join('\n');
    return [`    <Placemark>\n      <name>${xml(s.code)}</name>\n      <description>${xml(about)}</description>\n      <Point><coordinates>${round(p.lng)},${round(p.lat)},0</coordinates></Point>\n    </Placemark>`];
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${xml(project.name)} – monitoring sites</name>\n${marks.join('\n')}\n  </Document>\n</kml>\n`;
}
