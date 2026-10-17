import { describe, expect, it } from 'vitest';
import proj4 from 'proj4';
import { fromNztm, parseCoordinates, siteLatLng, toNztm } from '../src/lib/nztm';

const NZTM = '+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const places: Array<[string, number, number]> = [
  ['Cape Reinga', -34.4287, 172.6808],
  ['Hamilton', -37.787, 175.2793],
  ['Gisborne', -38.6623, 178.0176],
  ['Wellington', -41.2865, 174.7762],
  ['Bluff', -46.6, 168.33],
  ['Stewart Island', -47.28, 167.6], // NZTM covers the mainland and Stewart Island, not the Chathams
];

describe('NZTM', () => {
  it('matches proj4 to the millimetre, both ways', () => {
    for (const [, lat, lng] of places) {
      const [e, n] = proj4('WGS84', NZTM, [lng, lat]);
      const ours = toNztm(lat, lng);
      expect(Math.abs(ours.easting - e)).toBeLessThan(0.001);
      expect(Math.abs(ours.northing - n)).toBeLessThan(0.001);
      const back = fromNztm(e, n);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-8); // about a millimetre
      expect(Math.abs(back.lng - lng)).toBeLessThan(1e-8);
    }
  });

  it('places a site only when it has NZTM coordinates', () => {
    expect(siteLatLng({})).toBeNull();
    expect(siteLatLng({ easting: 1812345 })).toBeNull();
    expect(siteLatLng({ easting: 175.2, northing: -37.7 })).toBeNull();
    expect(siteLatLng({ easting: 1800000, northing: 5800000 })).toMatchObject({ lat: expect.closeTo(-37.94, 1), lng: expect.closeTo(175.27, 1) });
  });

  it('reads coordinates however they are written', () => {
    const hamilton = toNztm(-37.787, 175.2793);
    const near = (p: ReturnType<typeof parseCoordinates>) => p && Math.abs(p.easting - hamilton.easting) < 2 && Math.abs(p.northing - hamilton.northing) < 2;
    expect(near(parseCoordinates('-37.787, 175.2793'))).toBe(true);
    expect(near(parseCoordinates('175.2793 -37.787'))).toBe(true);
    expect(near(parseCoordinates('37.787, 175.2793'))).toBe(true); // south assumed
    expect(near(parseCoordinates(`37°47'13.2"S 175°16'45.5"E`))).toBe(true);
    expect(near(parseCoordinates(`${Math.round(hamilton.easting)} ${Math.round(hamilton.northing)}`))).toBe(true);
    expect(near(parseCoordinates(`N ${Math.round(hamilton.northing)}, E ${Math.round(hamilton.easting)}`))).toBe(true);
    expect(parseCoordinates('hello')).toBeNull();
    expect(parseCoordinates('51.5, -0.12')).toBeNull(); // London isn't in NZTM
    expect(parseCoordinates('1 2 3')).toBeNull();
  });
});
