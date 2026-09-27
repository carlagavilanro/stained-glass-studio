import type { Vec2 } from "../types";

export const EPSILON = 1e-9;

export function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function normalizeAngle(theta: number): number {
  const tau = Math.PI * 2;
  return ((theta % tau) + tau) % tau;
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function mul(a: Vec2, scalar: number): Vec2 {
  return { x: a.x * scalar, y: a.y * scalar };
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function normalize(a: Vec2): Vec2 {
  const len = length(a);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function signedArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  const area = signedArea(points);
  if (Math.abs(area) < EPSILON) {
    const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return mul(sum, 1 / Math.max(points.length, 1));
  }

  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const factor = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * factor;
    cy += (a.y + b.y) * factor;
  }

  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function boundsOf(points: Vec2[]): { min: Vec2; max: Vec2; width: number; height: number } {
  if (points.length === 0) {
    return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 }, width: 0, height: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    min: { x: minX, y: minY },
    max: { x: maxX, y: maxY },
    width: maxX - minX,
    height: maxY - minY
  };
}

function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const da = sub(a2, a1);
  const db = sub(b2, b1);
  const denominator = cross(da, db);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = cross(sub(b1, a1), db) / denominator;
  return add(a1, mul(da, t));
}

function inwardNormal(edgeStart: Vec2, edgeEnd: Vec2, orientationSign: number): Vec2 {
  const edge = normalize(sub(edgeEnd, edgeStart));
  if (orientationSign >= 0) {
    return { x: -edge.y, y: edge.x };
  }
  return { x: edge.y, y: -edge.x };
}

export function removeNearDuplicatePoints(points: Vec2[], tolerance = 1e-6): Vec2[] {
  const cleaned: Vec2[] = [];
  for (const point of points) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || distance(previous, point) > tolerance) {
      cleaned.push(point);
    }
  }

  if (cleaned.length > 1 && distance(cleaned[0], cleaned[cleaned.length - 1]) <= tolerance) {
    cleaned.pop();
  }

  return cleaned;
}

export function offsetPolygonInward(points: Vec2[], offsetMm: number, miterLimit = 6): Vec2[] {
  const cleanPoints = removeNearDuplicatePoints(points);
  if (cleanPoints.length < 3 || offsetMm <= 0) return cleanPoints;

  const orientationSign = Math.sign(signedArea(cleanPoints)) || 1;
  const result: Vec2[] = [];

  for (let i = 0; i < cleanPoints.length; i += 1) {
    const prev = cleanPoints[(i - 1 + cleanPoints.length) % cleanPoints.length];
    const curr = cleanPoints[i];
    const next = cleanPoints[(i + 1) % cleanPoints.length];

    const normalPrev = inwardNormal(prev, curr, orientationSign);
    const normalNext = inwardNormal(curr, next, orientationSign);

    const prevA = add(prev, mul(normalPrev, offsetMm));
    const prevB = add(curr, mul(normalPrev, offsetMm));
    const nextA = add(curr, mul(normalNext, offsetMm));
    const nextB = add(next, mul(normalNext, offsetMm));

    const intersection = lineIntersection(prevA, prevB, nextA, nextB);
    const averageNormal = normalize(add(normalPrev, normalNext));
    const fallback = add(curr, mul(length(averageNormal) < EPSILON ? normalNext : averageNormal, offsetMm));

    if (!intersection) {
      result.push(fallback);
      continue;
    }

    const miterDistance = distance(curr, intersection);
    if (miterDistance > Math.max(offsetMm * miterLimit, offsetMm + 0.001)) {
      result.push(fallback);
    } else {
      result.push(intersection);
    }
  }

  return removeNearDuplicatePoints(result);
}

export function polylineLength(points: Vec2[], closed = false): number {
  if (points.length < 2) return 0;
  let total = 0;
  const limit = closed ? points.length : points.length - 1;
  for (let i = 0; i < limit; i += 1) {
    total += distance(points[i], points[(i + 1) % points.length]);
  }
  return total;
}

export function fmt(value: number, digits = 3): string {
  return Number.isFinite(value) ? value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1") : "0";
}
