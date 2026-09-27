import type { FlatPatternDocument, LampConfig, Pattern, Vec2 } from "../types";
import { FrustumSurface } from "../geometry/frustumSurface";
import { fmt } from "../geometry/math";
import { createFlatDocumentFromFrustum } from "./svg";

function pair(code: number, value: string | number): string {
  return `${code}\n${value}`;
}

function lineEntity(layer: string, a: Vec2, b: Vec2): string {
  return [
    pair(0, "LINE"),
    pair(8, layer),
    pair(10, fmt(a.x, 4)),
    pair(20, fmt(a.y, 4)),
    pair(30, 0),
    pair(11, fmt(b.x, 4)),
    pair(21, fmt(b.y, 4)),
    pair(31, 0)
  ].join("\n");
}

function textEntity(layer: string, text: string, at: Vec2, height = 4): string {
  return [
    pair(0, "TEXT"),
    pair(8, layer),
    pair(10, fmt(at.x, 4)),
    pair(20, fmt(at.y, 4)),
    pair(30, 0),
    pair(40, height),
    pair(1, text)
  ].join("\n");
}

function polylineAsLines(layer: string, points: Vec2[], closed: boolean): string[] {
  const entities: string[] = [];
  if (points.length < 2) return entities;
  for (let i = 0; i < points.length - 1; i += 1) {
    entities.push(lineEntity(layer, points[i], points[i + 1]));
  }
  if (closed) {
    entities.push(lineEntity(layer, points[points.length - 1], points[0]));
  }
  return entities;
}

function centroid(points: Vec2[]): Vec2 {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function smoothClosedPolyline(points: Vec2[], iterations = 2): Vec2[] {
  if (points.length < 3) return points;
  let smoothed = points;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next: Vec2[] = [];
    for (let i = 0; i < smoothed.length; i += 1) {
      const a = smoothed[i];
      const b = smoothed[(i + 1) % smoothed.length];
      next.push(
        { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 }
      );
    }
    smoothed = next;
  }

  return smoothed;
}

export function exportFlatPatternDxf(document: FlatPatternDocument): string {
  const entities: string[] = [];

  for (const panel of document.panels) {
    for (const outline of panel.glassCutOutlines) {
      entities.push(...polylineAsLines("GLASS_CUT", outline, true));
    }
    entities.push(...polylineAsLines("PANEL_CENTERLINE", panel.centerlineOutline, true));
    entities.push(textEntity("LABELS", panel.id, centroid(panel.glassCutOutline.length ? panel.glassCutOutline : panel.centerlineOutline)));
  }

  for (const seam of document.seams) {
    entities.push(...polylineAsLines("SEAM_CENTERLINE", seam.points, Boolean(seam.closed)));
  }

  for (const region of document.solderRegions ?? []) {
    entities.push(...polylineAsLines("SOLDER_FILL_OUTLINE", smoothClosedPolyline(region.outline), true));
  }

  return [
    pair(0, "SECTION"),
    pair(2, "HEADER"),
    pair(9, "$INSUNITS"),
    pair(70, 4),
    pair(0, "ENDSEC"),
    pair(0, "SECTION"),
    pair(2, "ENTITIES"),
    ...entities,
    pair(0, "ENDSEC"),
    pair(0, "EOF")
  ].join("\n");
}

export function exportPatternDxf(config: LampConfig, pattern: Pattern, surface: FrustumSurface): string {
  return exportFlatPatternDxf(createFlatDocumentFromFrustum(config, pattern, surface));
}
