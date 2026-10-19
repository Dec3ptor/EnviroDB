// LINZ Basemaps key, as in PivotMap: visible to every visitor, as is normal for browser map keys.
export const LINZ_BASEMAPS_KEY = 'd01hep5551e30kxb7w85hck49tp';

/** A LINZ aerial imagery tile (Web Mercator). */
export const linzAerialTile = (z: number, x: number, y: number) => `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/${z}/${x}/${y}.webp?api=${LINZ_BASEMAPS_KEY}`;
