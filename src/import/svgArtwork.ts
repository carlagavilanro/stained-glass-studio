import type { FlatPatternDocument, LampConfig, Vec2 } from "../types";
import { boundsOf, clamp, fmt, removeNearDuplicatePoints } from "../geometry/math";
import { createFlatPatternDocument, type FlatOutlineInput } from "../geometry/flatPattern";
import { glassInsetFromConfig } from "../geometry/flatLayout";

function colorFromElement(element: Element, fallback: string): string {
  const fill = element.getAttribute("fill") || (element as SVGElement).style?.fill || "";
  if (fill && fill !== "none" && !fill.startsWith("url(")) return fill;
  const stroke = element.getAttribute("stroke") || (element as SVGElement).style?.stroke || "";
  if (stroke && stroke !== "none" && !stroke.startsWith("url(")) return stroke;
  return fallback;
}

function parsePointList(points: string | null): Vec2[] {
  if (!points) return [];
  const values = points
    .trim()
    .replace(/,/g, " ")
    .split(/\s+/)
    .map(Number)
    .filter(Number.isFinite);
  const result: Vec2[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    result.push({ x: values[i], y: values[i + 1] });
  }
  return result;
}

function matrixTransform(point: Vec2, matrix: DOMMatrix | SVGMatrix | null): Vec2 {
  if (!matrix) return point;
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

function samplePath(path: SVGGeometryElement): Vec2[] {
  const length = path.getTotalLength();
  const samples = Math.max(12, Math.min(320, Math.ceil(length / 4)));
  const matrix = path.getCTM();
  const points: Vec2[] = [];
  for (let i = 0; i < samples; i += 1) {
    const point = path.getPointAtLength((i / samples) * length);
    points.push(matrixTransform({ x: point.x, y: point.y }, matrix));
  }
  return removeNearDuplicatePoints(points, 0.001);
}

function circleOrEllipsePoints(element: SVGElement, samples = 64): Vec2[] {
  const cx = Number(element.getAttribute("cx") ?? 0);
  const cy = Number(element.getAttribute("cy") ?? 0);
  const rx = Number(element.getAttribute("rx") ?? element.getAttribute("r") ?? 0);
  const ry = Number(element.getAttribute("ry") ?? element.getAttribute("r") ?? rx);
  const matrix = (element as SVGGraphicsElement).getCTM();
  const points: Vec2[] = [];
  for (let i = 0; i < samples; i += 1) {
    const theta = (i / samples) * Math.PI * 2;
    points.push(matrixTransform({ x: cx + Math.cos(theta) * rx, y: cy + Math.sin(theta) * ry }, matrix));
  }
  return points;
}

function rectPoints(element: SVGElement): Vec2[] {
  const x = Number(element.getAttribute("x") ?? 0);
  const y = Number(element.getAttribute("y") ?? 0);
  const width = Number(element.getAttribute("width") ?? 0);
  const height = Number(element.getAttribute("height") ?? 0);
  const matrix = (element as SVGGraphicsElement).getCTM();
  return [
    matrixTransform({ x, y }, matrix),
    matrixTransform({ x: x + width, y }, matrix),
    matrixTransform({ x: x + width, y: y + height }, matrix),
    matrixTransform({ x, y: y + height }, matrix)
  ];
}

function scaleOutlines(outlines: FlatOutlineInput[], outputWidthMm: number, outputHeightMm: number): FlatOutlineInput[] {
  const bounds = boundsOf(outlines.flatMap((outline) => outline.outline));
  const scaleX = outputWidthMm / Math.max(bounds.width, 1e-9);
  const scaleY = outputHeightMm / Math.max(bounds.height, 1e-9);

  return outlines.map((outline) => ({
    ...outline,
    outline: outline.outline.map((point) => ({
      x: (point.x - bounds.min.x) * scaleX,
      y: (point.y - bounds.min.y) * scaleY
    }))
  }));
}

export async function svgArtworkToFlatPattern(file: File, config: LampConfig): Promise<FlatPatternDocument> {
  const text = await file.text();
  const parser = new DOMParser();
  const document = parser.parseFromString(text, "image/svg+xml");
  const parseError = document.querySelector("parsererror");
  if (parseError) throw new Error("The SVG could not be parsed.");

  const hidden = document.documentElement.cloneNode(true) as SVGSVGElement;
  if (hidden.localName !== 'svg') throw new Error('Choose an SVG document.');
  // Only inert geometry reaches the live DOM; imported files never execute code.
  const tags = new Set(['svg','g','path','polygon','polyline','rect','circle','ellipse']);
  const attributes = new Set(['viewBox','width','height','x','y','cx','cy','rx','ry','r','points','d','transform','fill','stroke']);
  for (const element of [hidden, ...hidden.querySelectorAll('*')]) {
    if (!tags.has(element.localName)) { element.remove(); continue; }
    for (const attribute of [...element.attributes]) {
      if (!attributes.has(attribute.name) || /url\s*\(/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  }
  hidden.style.position = "absolute";
  hidden.style.left = "-100000px";
  hidden.style.top = "-100000px";
  hidden.style.width = "1px";
  hidden.style.height = "1px";
  document.body?.appendChild(hidden);
  // Attach to the real browser document so getTotalLength/getCTM are available.
  const host = window.document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "-100000px";
  host.style.top = "-100000px";
  host.style.width = "1px";
  host.style.height = "1px";
  host.appendChild(hidden);
  window.document.body.appendChild(host);

  try {
    const palette = ["#d64f4f", "#f0b14b", "#f7e06e", "#6fbf73", "#4fb5d6", "#7567d9", "#c45bc8", "#f28ab2"];
    const outlines: FlatOutlineInput[] = [];
    let id = 1;

    hidden.querySelectorAll("polygon, polyline").forEach((element) => {
      const outline = parsePointList(element.getAttribute("points")).map((point) => matrixTransform(point, (element as SVGGraphicsElement).getCTM()));
      if (outline.length >= 3) {
        outlines.push({ id: `S${id++}`, color: colorFromElement(element, palette[id % palette.length]), outline });
      }
    });

    hidden.querySelectorAll("rect").forEach((element) => {
      const outline = rectPoints(element as SVGElement);
      if (outline.length >= 3) {
        outlines.push({ id: `S${id++}`, color: colorFromElement(element, palette[id % palette.length]), outline });
      }
    });

    hidden.querySelectorAll("circle, ellipse").forEach((element) => {
      const outline = circleOrEllipsePoints(element as SVGElement);
      if (outline.length >= 3) {
        outlines.push({ id: `S${id++}`, color: colorFromElement(element, palette[id % palette.length]), outline });
      }
    });

    hidden.querySelectorAll("path").forEach((element) => {
      const d = element.getAttribute("d") ?? "";
      const likelyClosed = /z\s*$/i.test(d.trim()) || (element.getAttribute("fill") ?? "") !== "none";
      if (!likelyClosed) return;
      try {
        const outline = samplePath(element as SVGGeometryElement);
        if (outline.length >= 3) {
          outlines.push({ id: `S${id++}`, color: colorFromElement(element, palette[id % palette.length]), outline });
        }
      } catch (error) {
        console.warn("Skipping SVG path that could not be sampled.", error);
      }
    });

    if (outlines.length === 0) {
      throw new Error("No closed SVG shapes were found. Use filled paths, polygons, rectangles, circles, or ellipses.");
    }

    const outputWidth = clamp(config.artworkWidthMm, 25, 5000);
    const outputHeight = clamp(config.artworkHeightMm, 25, 5000);
    const scaled = scaleOutlines(outlines, outputWidth, outputHeight);

    return createFlatPatternDocument(
      `Stained glass vector artwork from ${file.name}`,
      "Closed SVG shapes converted directly into stained-glass panel templates with robust inward came allowance.",
      scaled,
      glassInsetFromConfig(config),
      {
        sourceFile: file.name,
        sourceType: "svg vector artwork",
        importedShapes: scaled.length,
        outputWidthMm: fmt(outputWidth),
        outputHeightMm: fmt(outputHeight)
      }
    );
  } finally {
    host.remove();
  }
}
