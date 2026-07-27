// Club Phase 4 — GPS track simplification. Turns a raw FIT record stream
// (thousands of [lat,lng] points) into a compact polyline (target 50–150 points)
// for an SVG route silhouette. No mapping library; plain geometry in coordinate
// space, which is fine for a shape-only silhouette (not for distance).

export type LatLng = [number, number]; // [lat, lng] in degrees

export type TrackBbox = { minLat: number; minLng: number; maxLat: number; maxLng: number };

/** Perpendicular distance from point p to the segment a–b, in coordinate units. */
function perpDistance(p: LatLng, a: LatLng, b: LatLng): number {
  const [py, px] = p;
  const [ay, ax] = a;
  const [by, bx] = b;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ddx = px - ax;
    const ddy = py - ay;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  // Projection scalar t of p onto a–b, clamped to the segment.
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ddx = px - projX;
  const ddy = py - projY;
  return Math.sqrt(ddx * ddx + ddy * ddy);
}

/** Classic Douglas–Peucker with a fixed epsilon (coordinate units). */
function douglasPeucker(points: LatLng[], epsilon: number): LatLng[] {
  if (points.length <= 2) {
    return points.slice();
  }
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i += 1) {
    const d = perpDistance(points[i], points[0], points[end]);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

/** Drop consecutive duplicate / near-duplicate points before simplifying. */
function dedupe(points: LatLng[]): LatLng[] {
  const out: LatLng[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) {
      out.push(p);
    }
  }
  return out;
}

export function computeBbox(points: LatLng[]): TrackBbox | null {
  if (points.length === 0) {
    return null;
  }
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}

export type SimplifiedTrack = {
  polyline: LatLng[];
  bbox: TrackBbox;
  pointCount: number;
};

/**
 * Simplify a raw GPS point list to a compact polyline. Binary-searches the
 * Douglas–Peucker epsilon so the result lands in [minPoints, maxPoints]; if the
 * track is too short to simplify, returns it as-is (deduped). Returns null when
 * there are fewer than 2 usable points (no drawable track).
 */
export function simplifyTrack(
  raw: LatLng[],
  opts: { minPoints?: number; maxPoints?: number } = {}
): SimplifiedTrack | null {
  const minPoints = opts.minPoints ?? 50;
  const maxPoints = opts.maxPoints ?? 150;

  // Keep only finite, in-range coordinates (guards against 0/0 fill or semicircle bugs).
  const clean = dedupe(
    raw.filter(
      ([lat, lng]) =>
        Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
    )
  );
  if (clean.length < 2) {
    return null;
  }
  const bbox = computeBbox(clean);
  if (!bbox) {
    return null;
  }

  // Already small enough → round + return.
  const round = (p: LatLng): LatLng => [Number(p[0].toFixed(5)), Number(p[1].toFixed(5))];
  if (clean.length <= maxPoints) {
    const poly = clean.map(round);
    return { polyline: poly, bbox, pointCount: poly.length };
  }

  // Diagonal of the bbox seeds the epsilon search range.
  const diag = Math.sqrt(
    (bbox.maxLat - bbox.minLat) ** 2 + (bbox.maxLng - bbox.minLng) ** 2
  ) || 0.001;
  let lo = 0;
  let hi = diag;
  let best = douglasPeucker(clean, hi).map(round);
  // Binary search epsilon for a point count within the target band.
  for (let iter = 0; iter < 24; iter += 1) {
    const mid = (lo + hi) / 2;
    const simplified = douglasPeucker(clean, mid);
    if (simplified.length > maxPoints) {
      lo = mid; // too many points → need a larger epsilon
    } else {
      best = simplified.map(round);
      if (simplified.length >= minPoints) {
        break; // inside the band
      }
      hi = mid; // too few points → need a smaller epsilon
    }
  }
  return { polyline: best, bbox, pointCount: best.length };
}
