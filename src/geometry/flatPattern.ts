import type { FlatPanel, FlatPatternDocument, FlatSeam, LampConfig, Vec2 } from "../types";
import { boundsOf, fmt, polygonCentroid, polylineLength, removeNearDuplicatePoints, signedArea } from "./math";
import { offsetPolygonInwardRobustAll } from "./clipperOffset";

export type FlatOutlineInput = {
  id: string;
  color: string;
  outline: Vec2[];
};

function normalizeClosedOutline(outline: Vec2[]): Vec2[] {
  const cleaned = removeNearDuplicatePoints(outline, 1e-5);
  if (cleaned.length < 3) return [];
  return signedArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

function pointKey(point: Vec2, precision = 1000): string {
  return `${Math.round(point.x * precision)},${Math.round(point.y * precision)}`;
}

function edgeKey(a: Vec2, b: Vec2): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function inferPanelSeams(panels: FlatPanel[]): FlatSeam[] {
  const seams = new Map<string, FlatSeam>();
  let seamId = 1;

  for (const panel of panels) {
    for (let i = 0; i < panel.centerlineOutline.length; i += 1) {
      const a = panel.centerlineOutline[i];
      const b = panel.centerlineOutline[(i + 1) % panel.centerlineOutline.length];
      const key = edgeKey(a, b);
      if (!seams.has(key)) {
        seams.set(key, {
          id: `E${seamId++}`,
          points: [a, b]
        });
      }
    }
  }

  return [...seams.values()];
}

export function createFlatPanelsFromOutlines(outlines: FlatOutlineInput[], glassInsetMm: number): FlatPanel[] {
  return outlines.flatMap((input) => {
    const centerlineOutline = normalizeClosedOutline(input.outline);
    if (centerlineOutline.length < 3) return [];

    const glassCutOutlines = offsetPolygonInwardRobustAll(centerlineOutline, glassInsetMm);
    const largest = glassCutOutlines[0] ?? [];

    return [{
      id: input.id,
      color: input.color,
      centerlineOutline,
      glassCutOutline: largest,
      glassCutOutlines
    }];
  });
}

export function createFlatPatternDocument(
  title: string,
  description: string,
  outlines: FlatOutlineInput[],
  glassInsetMm: number,
  metadata: Record<string, string | number | boolean> = {},
  seams: FlatSeam[] = [],
  solderRegions: FlatPatternDocument["solderRegions"] = []
): FlatPatternDocument {
  const panels = createFlatPanelsFromOutlines(outlines, glassInsetMm);
  return {
    title,
    description,
    units: "mm",
    panels,
    seams: seams.length > 0 ? seams : inferPanelSeams(panels),
    solderRegions,
    metadata: {
      ...metadata,
      glassInsetMm: fmt(glassInsetMm),
      fitModel: metadata.fitModel ?? "glass pieces are cut from seam centerlines inset by half the came heart plus fit tolerance",
      solderAllowanceRule: "adjacent panels each receive half of the solder/came gap so assembled glass fits the shared seam network",
      offsetEngine: "clipper-lib integer offset"
    }
  };
}

export function measureFlatPatternDocument(
  config: LampConfig,
  document: FlatPatternDocument,
  modeLabel = "Flat pattern"
) {
  const allPoints = [
    ...document.panels.flatMap((panel) => panel.centerlineOutline),
    ...document.panels.flatMap((panel) => panel.glassCutOutlines.flat()),
    ...document.seams.flatMap((seam) => seam.points),
    ...(document.solderRegions ?? []).flatMap((region) => region.outline)
  ];
  const bounds = boundsOf(allPoints);
  const seamLength = document.seams.reduce((sum, seam) => sum + polylineLength(seam.points, Boolean(seam.closed)), 0);
  const splitCount = document.panels.reduce((sum, panel) => sum + Math.max(0, panel.glassCutOutlines.length - 1), 0);
  const emptyCuts = document.panels.filter((panel) => panel.glassCutOutline.length < 3).length;
  const solderRegionCount = document.solderRegions?.length ?? 0;
  const notes: string[] = [];

  if (splitCount > 0) {
    notes.push(`${splitCount} extra offset contour${splitCount === 1 ? "" : "s"} created where concave/narrow pieces split.`);
  }
  if (emptyCuts > 0) {
    notes.push(`${emptyCuts} piece${emptyCuts === 1 ? "" : "s"} became too small for the current came allowance.`);
  }
  if (emptyCuts === 0) {
    notes.push("Fit model: glass cuts are inset from shared seam centerlines by half the solder/came allowance.");
  }
  if (solderRegionCount > 0) {
    notes.push(`${solderRegionCount} flowed solder fill region${solderRegionCount === 1 ? "" : "s"} detected from dark separator areas.`);
  }
  if (seamLength > 0) {
    notes.push(`Approx. seam centerline length: ${fmt(seamLength)} mm.`);
  }

  return {
    modeLabel,
    panelCount: document.panels.length,
    seamCount: document.seams.length || document.panels.length,
    glassInsetMm: (config.cameHeartWidthMm + config.fitToleranceMm) / 2,
    unrolledWidthMm: bounds.width,
    slantHeightMm: bounds.height,
    maxPanelSagittaMm: 0,
    notes
  };
}

export function labelPointForPanel(panel: FlatPanel): Vec2 {
  return polygonCentroid(panel.glassCutOutline.length >= 3 ? panel.glassCutOutline : panel.centerlineOutline);
}
