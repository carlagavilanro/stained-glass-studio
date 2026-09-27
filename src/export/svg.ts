import type { FlatPatternDocument, LampConfig, Pattern, Vec2 } from "../types";
import { FrustumSurface } from "../geometry/frustumSurface";
import { createFlatPanels, glassInsetFromConfig, sampleUvPolylineToFlat } from "../geometry/flatLayout";
import { boundsOf, fmt } from "../geometry/math";
import { labelPointForPanel } from "../geometry/flatPattern";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pointList(points: Vec2[]): string {
  return points.map((point) => `${fmt(point.x)},${fmt(point.y)}`).join(" ");
}

function pathData(points: Vec2[], close = true): string {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  const commands = [`M ${fmt(first.x)} ${fmt(first.y)}`];
  for (const point of rest) {
    commands.push(`L ${fmt(point.x)} ${fmt(point.y)}`);
  }
  if (close) commands.push("Z");
  return commands.join(" ");
}

function roundedPathData(points: Vec2[]): string {
  if (points.length < 3) return pathData(points);
  const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = midpoint(points[points.length - 1], points[0]);
  const commands = [`M ${fmt(start.x)} ${fmt(start.y)}`];

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const end = midpoint(current, next);
    commands.push(`Q ${fmt(current.x)} ${fmt(current.y)} ${fmt(end.x)} ${fmt(end.y)}`);
  }

  commands.push("Z");
  return commands.join(" ");
}

function metadataXml(metadata: FlatPatternDocument["metadata"]): string {
  return Object.entries(metadata)
    .map(([key, value]) => `    ${escapeXml(key)}=${escapeXml(String(value))};`)
    .join("\n");
}

export function exportFlatPatternSvg(document: FlatPatternDocument): string {
  const allPoints = [
    ...document.panels.flatMap((panel) => panel.centerlineOutline),
    ...document.panels.flatMap((panel) => panel.glassCutOutlines.flat()),
    ...document.seams.flatMap((seam) => seam.points),
    ...(document.solderRegions ?? []).flatMap((region) => region.outline)
  ];
  const bounds = boundsOf(allPoints);
  const margin = 20;
  const minX = bounds.min.x - margin;
  const minY = bounds.min.y - margin;
  const width = Math.max(bounds.width + margin * 2, 10);
  const height = Math.max(bounds.height + margin * 2, 10);
  const generatedAt = new Date().toISOString();

  const centerlines = document.panels
    .map(
      (panel) =>
        `<path d="${pathData(panel.centerlineOutline)}" class="centerline" data-panel="${escapeXml(panel.id)}" />`
    )
    .join("\n    ");

  const glassCuts = document.panels
    .flatMap((panel) =>
      panel.glassCutOutlines.map(
        (outline, index) =>
          `<path d="${pathData(outline)}" class="glass-cut" fill="${escapeXml(panel.color)}" data-panel="${escapeXml(panel.id)}" data-contour="${index + 1}" />`
      )
    )
    .join("\n    ");

  const labels = document.panels
    .map((panel) => {
      const labelPoint = labelPointForPanel(panel);
      return `<text x="${fmt(labelPoint.x)}" y="${fmt(labelPoint.y)}" class="label">${escapeXml(panel.id)}</text>`;
    })
    .join("\n    ");

  const seams = document.seams
    .map((seam) => {
      if (seam.closed) {
        return `<path d="${pathData(seam.points)}" class="seam" data-seam="${escapeXml(seam.id)}" />`;
      }
      return `<polyline points="${pointList(seam.points)}" class="seam" data-seam="${escapeXml(seam.id)}" />`;
    })
    .join("\n    ");
  const solderFills = (document.solderRegions ?? [])
    .map((region) => `<path d="${roundedPathData(region.outline)}" class="solder-fill" data-solder="${escapeXml(region.id)}" />`)
    .join("\n    ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width)}mm" height="${fmt(height)}mm" viewBox="${fmt(minX)} ${fmt(minY)} ${fmt(width)} ${fmt(height)}">
  <title>${escapeXml(document.title)}</title>
  <desc>${escapeXml(document.description)} Generated ${generatedAt}. Units are millimeters.</desc>
  <metadata>
${metadataXml(document.metadata)}
  </metadata>
  <style>
    .glass-cut { fill-opacity: 0.18; stroke: #111; stroke-width: 0.06; vector-effect: non-scaling-stroke; }
    .solder-fill { fill: #4d5156; fill-opacity: 0.72; stroke: #222; stroke-width: 0.16; }
    .centerline { fill: none; stroke: #666; stroke-width: 0.18; stroke-dasharray: 2 2; }
    .seam { fill: none; stroke: #000; stroke-width: 0.22; stroke-opacity: 0.42; }
    .label { font: 5px sans-serif; text-anchor: middle; dominant-baseline: middle; fill: #111; }
  </style>
  <g id="flowed-solder-fill-regions">
    ${solderFills}
  </g>
  <g id="seam-centerlines">
    ${seams}
  </g>
  <g id="panel-centerline-outlines">
    ${centerlines}
  </g>
  <g id="glass-cut-outlines">
    ${glassCuts}
  </g>
  <g id="labels">
    ${labels}
  </g>
</svg>
`;
}

export function createFlatDocumentFromFrustum(config: LampConfig, pattern: Pattern, surface: FrustumSurface): FlatPatternDocument {
  const glassInsetMm = glassInsetFromConfig(config);
  return {
    title: "Stained glass lampshade pattern",
    description: `Frustum/cylinder pattern with ${fmt(glassInsetMm)} mm inward glass offset per piece.`,
    units: "mm",
    panels: createFlatPanels(pattern, surface, glassInsetMm),
    seams: pattern.seams.map((seam) => ({
      id: seam.id,
      points: sampleUvPolylineToFlat(surface, seam.uv, 6),
      closed: Boolean(seam.closed)
    })),
    metadata: {
      bottomRadiusMm: fmt(config.bottomRadiusMm),
      topRadiusMm: fmt(config.topRadiusMm),
      heightMm: fmt(config.heightMm),
      radialSegments: config.radialSegments,
      bands: config.bands,
      cameHeartWidthMm: fmt(config.cameHeartWidthMm),
      fitToleranceMm: fmt(config.fitToleranceMm),
      glassInsetMm: fmt(glassInsetMm),
      visibleLeadFaceWidthMm: fmt(config.visibleLeadFaceWidthMm),
      offsetEngine: "clipper-lib integer offset"
    }
  };
}

export function exportPatternSvg(config: LampConfig, pattern: Pattern, surface: FrustumSurface): string {
  return exportFlatPatternSvg(createFlatDocumentFromFrustum(config, pattern, surface));
}
