import { describe, expect, it } from 'vitest';
import type { Site } from '../src/db/types';
import { sitesGeoJson, sitesKml } from '../src/lib/sitesGeo';
import { toNztm } from '../src/lib/nztm';

const at = toNztm(-37.787, 175.2793);
const site = (code: string, patch: Partial<Site> = {}): Site => ({ id: code, projectId: 'p', code, type: 'Surface water', role: '', aliases: [], active: true, order: 1, ...patch });
const sites = [
  site('SW1', { name: 'Stream <upstream> & ford', easting: Math.round(at.easting), northing: Math.round(at.northing), role: 'Upstream / control' }),
  site('SW2'), // not on the map
];

describe('site map files', () => {
  it('writes GeoJSON for QGIS with the NZTM coordinates kept', () => {
    const gj = JSON.parse(sitesGeoJson(sites, { name: 'Example', code: 'EX-1' }));
    expect(gj.type).toBe('FeatureCollection');
    expect(gj.features).toHaveLength(1);
    const [f] = gj.features;
    expect(f.geometry.type).toBe('Point');
    expect(f.geometry.coordinates[0]).toBeCloseTo(175.2793, 4);
    expect(f.geometry.coordinates[1]).toBeCloseTo(-37.787, 4);
    expect(f.properties).toMatchObject({ code: 'SW1', name: 'Stream <upstream> & ford', role: 'Upstream / control', easting_nztm: Math.round(at.easting), project_code: 'EX-1' });
  });

  it('writes KML for Google Earth, escaping names', () => {
    const kml = sitesKml(sites, { name: 'Example & co' });
    expect(kml.match(/<Placemark>/g)).toHaveLength(1);
    expect(kml).toContain('<name>Example &amp; co – monitoring sites</name>');
    expect(kml).toContain('Stream &lt;upstream&gt; &amp; ford');
    expect(kml).toMatch(/<coordinates>175\.279\d+,-37\.787\d*,0<\/coordinates>/);
  });
});
