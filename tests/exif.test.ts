import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { readPhotoInfo, withPhotoGps } from '../src/lib/exif';

const photo = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/photos/${name}.jpg`));
const here = { lat: -37.786123, lng: 175.279314, acc: 4.2 };
const close = (a: number | undefined, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(1e-6);
/** Set EXIF_OUT to a folder to keep what's written (to check it with another reader). */
const keep = (name: string, b: Uint8Array) => process.env.EXIF_OUT && writeFileSync(`${process.env.EXIF_OUT}/${name}.jpg`, b);

describe('a photo’s location in the JPEG (EXIF)', () => {
  it('reads what a camera wrote: its location and when it was taken', () => {
    expect(readPhotoInfo(photo('plain'))).toEqual({});
    const gps = readPhotoInfo(photo('gps')).gps!;
    close(gps.lat, -37.5);
    close(gps.lng, 175.25);
    expect(readPhotoInfo(photo('camera'))).toEqual({ taken: '2026-10-31T09:15:22' });
  });

  it('writes the location into a plain photo, after its JFIF header', () => {
    const before = photo('plain');
    const out = withPhotoGps(before, here, '2026-10-31T20:15:22Z');
    keep('plain-gps', out);
    expect(out.length).toBeGreaterThan(before.length);
    expect([out[0], out[1], out[2], out[3]]).toEqual([0xff, 0xd8, 0xff, 0xe0]); // still JFIF first
    const got = readPhotoInfo(out).gps!;
    close(got.lat, here.lat);
    close(got.lng, here.lng);
    // the picture itself is untouched: the end of the file is the same bytes
    expect(Array.from(out.subarray(out.length - 200))).toEqual(Array.from(before.subarray(before.length - 200)));
  });

  it('adds it to a camera’s EXIF without losing anything there', () => {
    const out = withPhotoGps(photo('camera'), here, new Date('2026-10-31T20:15:22Z'));
    keep('camera-gps', out);
    const info = readPhotoInfo(out);
    close(info.gps!.lat, here.lat);
    close(info.gps!.lng, here.lng);
    expect(info.taken).toBe('2026-10-31T09:15:22'); // the camera's sub-directory still found
  });

  it('works in either byte order, and either hemisphere', () => {
    const out = withPhotoGps(photo('bigendian'), { lat: 45.1234567, lng: -73.7654321 });
    keep('bigendian-gps', out);
    const got = readPhotoInfo(out).gps!;
    close(got.lat, 45.1234567);
    close(got.lng, -73.7654321);
  });

  it('leaves alone a photo that has its camera’s location, or isn’t a JPEG, or is given nonsense', () => {
    const gps = photo('gps');
    expect(withPhotoGps(gps, here)).toBe(gps);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(withPhotoGps(png, here)).toBe(png);
    const plain = photo('plain');
    expect(withPhotoGps(plain, { lat: 95, lng: 0 })).toBe(plain);
    expect(withPhotoGps(plain, { lat: NaN, lng: 1 })).toBe(plain);
  });

  it('written twice, the first location stays', () => {
    const once = withPhotoGps(photo('plain'), here);
    expect(withPhotoGps(once, { lat: 1, lng: 2 })).toBe(once);
  });
});
