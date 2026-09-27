import type { FlatPanel, LampConfig, LayoutStats, Panel, Pattern, UV, Vec2 } from "../types";
import { FrustumSurface } from "./frustumSurface";
import { boundsOf, removeNearDuplicatePoints, signedArea } from "./math";
import { offsetPolygonInwardRobustAll } from "./clipperOffset";

function estimatedSurfaceEdgeLength(surface: FrustumSurface, a: UV, b: UV): number {
  const midZ = (a.z + b.z) / 2;
  const avgRadius = surface.radiusAtZ(midZ);
  const hoopLength = Math.abs(b.theta - a.theta) * avgRadius;
  const heightLength = Math.abs(b.z - a.z);
  return Math.hypot(hoopLength, heightLength);
}

export function sampleUvPolygonToFlat(surface: FrustumSurface, uv: UV[], targetSegmentLengthMm = 8): Vec2[] {
  if (uv.length < 2) return uv.map((point) => surface.uvToFlat(point));

  const points: Vec2[] = [];
  for (let i = 0; i < uv.length; i += 1) {
    const a = uv[i];
    const b = uv[(i + 1) % uv.length];
    const segmentLength = estimatedSurfaceEdgeLength(surface, a, b);
    const steps = Math.max(1, Math.ceil(segmentLength / targetSegmentLengthMm));

    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      points.push(surface.uvToFlat(surface.uvLerp(a, b, t)));
    }
  }

  const cleaned = removeNearDuplicatePoints(points);
  return signedArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

export function sampleUvPolylineToFlat(surface: FrustumSurface, uv: UV[], targetSegmentLengthMm = 8): Vec2[] {
  if (uv.length < 2) return uv.map((point) => surface.uvToFlat(point));

  const points: Vec2[] = [];
  for (let i = 0; i < uv.length - 1; i += 1) {
    const a = uv[i];
    const b = uv[i + 1];
    const segmentLength = estimatedSurfaceEdgeLength(surface, a, b);
    const steps = Math.max(1, Math.ceil(segmentLength / targetSegmentLengthMm));

    for (let step = 0; step < steps; step += 1) {
      const t = step / steps;
      points.push(surface.uvToFlat(surface.uvLerp(a, b, t)));
    }
  }
  points.push(surface.uvToFlat(uv[uv.length - 1]));
  return removeNearDuplicatePoints(points);
}

export function glassInsetFromConfig(config: LampConfig): number {
  return (config.cameHeartWidthMm + config.fitToleranceMm) / 2;
}

export function createFlatPanels(pattern: Pattern, surface: FrustumSurface, glassInsetMm: number): FlatPanel[] {
  return pattern.panels.map((panel) => {
    const centerlineOutline = sampleUvPolygonToFlat(surface, panel.uv);
    const glassCutOutlines = offsetPolygonInwardRobustAll(centerlineOutline, glassInsetMm);
    const glassCutOutline = glassCutOutlines[0] ?? [];
    return {
      id: panel.id,
      color: panel.color,
      centerlineOutline,
      glassCutOutline,
      glassCutOutlines
    };
  });
}

function panelSagittaMm(surface: FrustumSurface, panel: Panel): number {
  const thetaValues = panel.uv.map((point) => point.theta);
  const zValues = panel.uv.map((point) => point.z);
  const minTheta = Math.min(...thetaValues);
  const maxTheta = Math.max(...thetaValues);
  const midZ = (Math.min(...zValues) + Math.max(...zValues)) / 2;
  const radius = surface.radiusAtZ(midZ);
  const thetaSpan = maxTheta - minTheta;
  return radius * (1 - Math.cos(thetaSpan / 2));
}

export function measureLayout(config: LampConfig, pattern: Pattern, surface: FrustumSurface): LayoutStats {
  const flatPoints = pattern.panels.flatMap((panel) => sampleUvPolygonToFlat(surface, panel.uv));
  const bounds = boundsOf(flatPoints);
  const maxPanelSagittaMm = Math.max(...pattern.panels.map((panel) => panelSagittaMm(surface, panel)));

  return {
    modeLabel: "Frustum generator",
    panelCount: pattern.panels.length,
    seamCount: pattern.seams.length,
    glassInsetMm: glassInsetFromConfig(config),
    unrolledWidthMm: Math.max(bounds.width, surface.unrolledWidthAtBottomMm()),
    slantHeightMm: surface.slantHeightMm(),
    maxPanelSagittaMm,
    notes: []
  };
}
