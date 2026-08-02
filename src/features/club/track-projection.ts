// Deterministic Web-Mercator projection shared by the SERVER (builds the Mapbox static image at
// an explicit center+zoom, tiles only) and the CLIENT (overlays the route as an SVG with tapered
// ends, pixel-aligned to that raster). Mapbox Static Images use 512px tiles + Web Mercator; by
// computing the SAME center+zoom on both sides from the SAME polyline, the overlay lines up with
// the tiles without shipping any extra data. This replaces the old baked-in `path(...)` overlay,
// so the fade lives in the SVG (client-controllable, independent of the Mapbox image cache).

export type LatLng = [number, number];
export type MapView = { centerLng: number; centerLat: number; zoom: number };

// Logical image size (Mapbox `@2x` doubles the PIXELS, not the logical coordinate space) and the
// inner padding kept clear of the route. Must match MAPBOX_IMAGE_SIZE in track-maps.ts.
export const TRACK_IMG_W = 600;
export const TRACK_IMG_H = 300;
export const TRACK_IMG_PAD = 44;
const TILE = 512;

const mercX = (lng: number): number => (lng + 180) / 360;
const mercY = (lat: number): number => {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)) / (2 * Math.PI);
};
const invMercY = (y: number): number => {
  const t = Math.exp((0.5 - y) * 2 * Math.PI);
  return (2 * Math.atan(t) - Math.PI / 2) * (180 / Math.PI);
};

function bboxOf(polyline: LatLng[]): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
  for (const [lat, lng] of polyline) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

/** Center + zoom that fits the polyline into TRACK_IMG_W x TRACK_IMG_H with TRACK_IMG_PAD margin.
 *  Deterministic: server and client derive it from the same polyline, so both agree exactly. */
export function fitView(polyline: LatLng[]): MapView {
  const b = bboxOf(polyline);
  const x1 = mercX(b.minLng), x2 = mercX(b.maxLng);
  const y1 = mercY(b.maxLat), y2 = mercY(b.minLat); // maxLat maps to the smaller y
  const dx = Math.max(1e-9, x2 - x1);
  const dy = Math.max(1e-9, y2 - y1);
  const zoomX = Math.log2((TRACK_IMG_W - 2 * TRACK_IMG_PAD) / (TILE * dx));
  const zoomY = Math.log2((TRACK_IMG_H - 2 * TRACK_IMG_PAD) / (TILE * dy));
  const zoom = Math.max(1, Math.min(18, Math.min(zoomX, zoomY)));
  return {
    centerLng: (b.minLng + b.maxLng) / 2,
    centerLat: invMercY((y1 + y2) / 2),
    zoom,
  };
}

/** Project a coordinate into the TRACK_IMG_W x TRACK_IMG_H logical image space (origin top-left). */
export function projectToImage(lng: number, lat: number, view: MapView): { x: number; y: number } {
  const worldSize = TILE * Math.pow(2, view.zoom);
  return {
    x: (mercX(lng) - mercX(view.centerLng)) * worldSize + TRACK_IMG_W / 2,
    y: (mercY(lat) - mercY(view.centerLat)) * worldSize + TRACK_IMG_H / 2,
  };
}

/** Per-vertex opacity that ramps 0..1 over the first/last `fraction` of the track, so the cropped
 *  ends fade out instead of stopping hard. Returns a function opacity(index). */
export function endFadeOpacity(pointCount: number, fraction = 0.16): (i: number) => number {
  const k = Math.max(2, Math.round(pointCount * fraction));
  return (i: number): number => {
    let a = 1;
    if (i < k) a = Math.min(a, i / k);
    if (i >= pointCount - k) a = Math.min(a, (pointCount - 1 - i) / k);
    return a;
  };
}
