import ClipperLib from "clipper-lib";
import type { Vec2 } from "../types";
import { offsetPolygonInward as fallbackOffsetPolygonInward, removeNearDuplicatePoints, signedArea } from "./math";

const SCALE = 1000;
const MIN_AREA_MM2 = 0.01;

type IntPoint = { X: number; Y: number };

function toClipperPath(points: Vec2[]): IntPoint[] {
  return points.map((point) => ({
    X: Math.round(point.x * SCALE),
    Y: Math.round(point.y * SCALE)
  }));
}

function fromClipperPath(path: IntPoint[]): Vec2[] {
  return removeNearDuplicatePoints(
    path.map((point) => ({ x: point.X / SCALE, y: point.Y / SCALE })),
    1 / SCALE
  );
}

function normalizeOrientation(points: Vec2[]): Vec2[] {
  const clean = removeNearDuplicatePoints(points);
  if (clean.length < 3) return clean;
  return signedArea(clean) < 0 ? [...clean].reverse() : clean;
}

function sortByAbsoluteAreaDescending(paths: Vec2[][]): Vec2[][] {
  return [...paths].sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}

/**
 * Robust inward polygon offset using Clipper's integer kernel.
 *
 * Clipper may return multiple contours when a narrow or concave polygon splits after an inward offset.
 * The caller can keep all contours for exports, or use offsetPolygonInwardRobust() for the largest one.
 */
export function offsetPolygonInwardRobustAll(points: Vec2[], offsetMm: number): Vec2[][] {
  const clean = normalizeOrientation(points);
  if (clean.length < 3 || offsetMm <= 0) return clean.length >= 3 ? [clean] : [];

  try {
    const clipperPath = toClipperPath(clean);
    const offsetter = new ClipperLib.ClipperOffset(2, 0.25 * SCALE);
    offsetter.AddPath(clipperPath, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);

    const solution: IntPoint[][] = [];
    offsetter.Execute(solution, -offsetMm * SCALE);

    const paths = solution
      .map(fromClipperPath)
      .map(normalizeOrientation)
      .filter((path) => path.length >= 3 && Math.abs(signedArea(path)) > MIN_AREA_MM2);

    if (paths.length > 0) {
      return sortByAbsoluteAreaDescending(paths);
    }
  } catch (error) {
    console.warn("Clipper offset failed; falling back to local miter offset.", error);
  }

  const fallback = normalizeOrientation(fallbackOffsetPolygonInward(clean, offsetMm));
  return fallback.length >= 3 && Math.abs(signedArea(fallback)) > MIN_AREA_MM2 ? [fallback] : [];
}

/** Largest inward-offset contour for tools that expect one cut outline per panel. */
export function offsetPolygonInwardRobust(points: Vec2[], offsetMm: number): Vec2[] {
  return offsetPolygonInwardRobustAll(points, offsetMm)[0] ?? [];
}
