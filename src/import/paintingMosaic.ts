import type { FlatPatternDocument, LampConfig, Vec2 } from "../types";
import { clamp, fmt } from "../geometry/math";
import { createFlatPatternDocument, type FlatOutlineInput } from "../geometry/flatPattern";
import { glassInsetFromConfig } from "../geometry/flatLayout";

const PALETTE_FALLBACK = ["#d64f4f", "#f0b14b", "#f7e06e", "#6fbf73", "#4fb5d6", "#7567d9", "#c45bc8", "#f28ab2"];

type Seed = {
  x: number;
  y: number;
  color: string;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const imageBitmap = await createImageBitmap(file);
  const maxSide = 1024;
  const scale = Math.min(1, maxSide / Math.max(imageBitmap.width, imageBitmap.height));
  const width = Math.max(8, Math.round(imageBitmap.width * scale));
  const height = Math.max(8, Math.round(imageBitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not create 2D canvas context for artwork import.");
  context.drawImage(imageBitmap, 0, 0, width, height);
  return canvas;
}

function nearestSeedIndex(x: number, y: number, seeds: Seed[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < seeds.length; i += 1) {
    const dx = x - seeds[i].x;
    const dy = y - seeds[i].y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function initializeSeeds(width: number, height: number, count: number): Seed[] {
  const rand = mulberry32(width * 73856093 ^ height * 19349663 ^ count * 83492791);
  const columns = Math.ceil(Math.sqrt(count * (width / height)));
  const rows = Math.ceil(count / columns);
  const seeds: Seed[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns && seeds.length < count; column += 1) {
      seeds.push({
        x: ((column + 0.5 + (rand() - 0.5) * 0.35) / columns) * width,
        y: ((row + 0.5 + (rand() - 0.5) * 0.35) / rows) * height,
        color: PALETTE_FALLBACK[seeds.length % PALETTE_FALLBACK.length]
      });
    }
  }

  return seeds;
}

function relaxSeeds(canvas: HTMLCanvasElement, seeds: Seed[], iterations: number): Seed[] {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return seeds;

  const { width, height } = canvas;
  const image = context.getImageData(0, 0, width, height).data;
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 26000)));
  let relaxed = seeds;

  for (let iteration = 0; iteration <= iterations; iteration += 1) {
    const sums = relaxed.map(() => ({ x: 0, y: 0, r: 0, g: 0, b: 0, n: 0 }));

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const index = nearestSeedIndex(x + 0.5, y + 0.5, relaxed);
        const pixel = (y * width + x) * 4;
        const alpha = image[pixel + 3] / 255;
        sums[index].x += x + 0.5;
        sums[index].y += y + 0.5;
        sums[index].r += image[pixel] * alpha + 255 * (1 - alpha);
        sums[index].g += image[pixel + 1] * alpha + 255 * (1 - alpha);
        sums[index].b += image[pixel + 2] * alpha + 255 * (1 - alpha);
        sums[index].n += 1;
      }
    }

    relaxed = relaxed.map((seed, index) => {
      const sum = sums[index];
      if (sum.n === 0) return seed;
      return {
        x: iteration < iterations ? sum.x / sum.n : seed.x,
        y: iteration < iterations ? sum.y / sum.n : seed.y,
        color: rgbToHex(sum.r / sum.n, sum.g / sum.n, sum.b / sum.n)
      };
    });
  }

  return relaxed;
}

function clipHalfPlane(polygon: Vec2[], a: Seed, b: Seed): Vec2[] {
  const keep = (point: Vec2) => {
    const dxA = point.x - a.x;
    const dyA = point.y - a.y;
    const dxB = point.x - b.x;
    const dyB = point.y - b.y;
    return dxA * dxA + dyA * dyA <= dxB * dxB + dyB * dyB + 1e-7;
  };

  const intersect = (p: Vec2, q: Vec2): Vec2 => {
    const vx = q.x - p.x;
    const vy = q.y - p.y;
    const numerator = (b.x * b.x + b.y * b.y - a.x * a.x - a.y * a.y) / 2 - ((b.x - a.x) * p.x + (b.y - a.y) * p.y);
    const denominator = (b.x - a.x) * vx + (b.y - a.y) * vy;
    const t = Math.abs(denominator) < 1e-9 ? 0 : numerator / denominator;
    return { x: p.x + vx * t, y: p.y + vy * t };
  };

  const output: Vec2[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const current = polygon[i];
    const previous = polygon[(i - 1 + polygon.length) % polygon.length];
    const currentInside = keep(current);
    const previousInside = keep(previous);

    if (currentInside && !previousInside) output.push(intersect(previous, current));
    if (currentInside) output.push(current);
    if (!currentInside && previousInside) output.push(intersect(previous, current));
  }
  return output;
}

function voronoiCells(width: number, height: number, seeds: Seed[]): Vec2[][] {
  const rectangle = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height }
  ];

  return seeds.map((seed, seedIndex) => {
    let cell = rectangle;
    for (let otherIndex = 0; otherIndex < seeds.length && cell.length > 0; otherIndex += 1) {
      if (otherIndex === seedIndex) continue;
      cell = clipHalfPlane(cell, seed, seeds[otherIndex]);
    }
    return cell;
  });
}

function scalePolygonToMm(points: Vec2[], imageWidth: number, imageHeight: number, outputWidthMm: number, outputHeightMm: number): Vec2[] {
  return points.map((point) => ({
    x: (point.x / imageWidth) * outputWidthMm,
    y: (point.y / imageHeight) * outputHeightMm
  }));
}

type Rgb = { r: number; g: number; b: number };
type TracePiece = { outline: Vec2[]; color: string; area: number };
type TraceSolderRegion = { outline: Vec2[]; area: number };
type TraceResult = { pieces: TracePiece[]; solderRegions: TraceSolderRegion[] };

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max <= 0 ? 0 : (max - min) / max;
}

function bridgeOnePixelLineGaps(mask: Uint8Array, width: number, height: number): Uint8Array {
  const bridged = new Uint8Array(mask);
  const at = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (mask[index]) continue;

      if (
        (at(x - 1, y) && at(x + 1, y)) ||
        (at(x, y - 1) && at(x, y + 1)) ||
        (at(x - 1, y - 1) && at(x + 1, y + 1)) ||
        (at(x + 1, y - 1) && at(x - 1, y + 1))
      ) {
        bridged[index] = 1;
      }
    }
  }

  return bridged;
}

function removeIsolatedLineNoise(mask: Uint8Array, width: number, height: number): Uint8Array {
  const cleaned = new Uint8Array(mask);
  const at = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!mask[index]) continue;

      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx !== 0 || dy !== 0) && at(x + dx, y + dy)) neighbors += 1;
        }
      }
      if (neighbors === 0) cleaned[index] = 0;
    }
  }

  return cleaned;
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const dilated = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mask[ny * width + nx]) {
            found = true;
            break;
          }
        }
      }
      if (found) dilated[y * width + x] = 1;
    }
  }

  return dilated;
}

function erodeMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const eroded = new Uint8Array(mask.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let kept = true;
      for (let dy = -radius; dy <= radius && kept; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height || !mask[ny * width + nx]) {
            kept = false;
            break;
          }
        }
      }
      if (kept) eroded[y * width + x] = 1;
    }
  }

  return eroded;
}

function otsuThreshold(histogram: Uint32Array, total: number): number {
  if (total <= 0) return 0;

  let sum = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    sum += i * histogram[i];
  }

  let sumBackground = 0;
  let weightBackground = 0;
  let bestVariance = -1;
  let bestThreshold = 0;

  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    weightBackground += histogram[threshold];
    if (weightBackground === 0) continue;

    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += threshold * histogram[threshold];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function buildAdaptiveLeadMask(image: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const total = width * height;
  const lumas = new Float32Array(total);
  const alphas = new Float32Array(total);
  const integral = new Float32Array((width + 1) * (height + 1));
  const histogram = new Uint32Array(256);
  let opaquePixels = 0;

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const p = index * 4;
      const alpha = image[p + 3] / 255;
      const r = image[p] * alpha + 255 * (1 - alpha);
      const g = image[p + 1] * alpha + 255 * (1 - alpha);
      const b = image[p + 2] * alpha + 255 * (1 - alpha);
      const value = luma(r, g, b);
      lumas[index] = value;
      alphas[index] = alpha;
      rowSum += value;
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + rowSum;

      if (alpha > 0.03) {
        histogram[Math.round(clamp(value, 0, 255))] += 1;
        opaquePixels += 1;
      }
    }
  }

  const radius = Math.max(3, Math.round(Math.min(width, height) / 55));
  const adaptiveContrast = Math.max(10, Math.round((180 - threshold) / 5));
  const globalDarkCutoff = clamp(Math.max(threshold, otsuThreshold(histogram, opaquePixels) + 18), threshold, 190);
  const mask = new Uint8Array(total);

  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (alphas[index] <= 0.03) continue;

      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum =
        integral[(y1 + 1) * (width + 1) + x1 + 1] -
        integral[y0 * (width + 1) + x1 + 1] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const localMean = sum / area;
      const p = index * 4;
      const alpha = alphas[index];
      const r = image[p] * alpha + 255 * (1 - alpha);
      const g = image[p + 1] * alpha + 255 * (1 - alpha);
      const b = image[p + 2] * alpha + 255 * (1 - alpha);
      const value = lumas[index];
      const sat = saturation(r, g, b);
      const localDrop = localMean - value;

      const blackInkSolder = value <= globalDarkCutoff && sat < 0.52;
      const antiAliasedInkSolder = value <= threshold + 82 && sat < 0.22 && (value < 95 || localDrop > 8);
      const absoluteSolder = value < threshold + 10 && (sat < 0.62 || localDrop > 5);
      const contrastSolder = value < threshold + 58 && localDrop > adaptiveContrast;
      const graySolder = value < threshold + 30 && sat < 0.24 && localDrop > 4;

      if (blackInkSolder || antiAliasedInkSolder || absoluteSolder || contrastSolder || graySolder) {
        mask[index] = 1;
      }
    }
  }

  return removeIsolatedLineNoise(bridgeOnePixelLineGaps(mask, width, height), width, height);
}

function buildLiquidSolderMask(image: Uint8ClampedArray, width: number, height: number, threshold: number): Uint8Array {
  const base = buildAdaptiveLeadMask(image, width, height, threshold);
  const flowRadius = Math.max(2, Math.round(Math.min(width, height) / 120));
  const closed = erodeMask(dilateMask(base, width, height, flowRadius), width, height, flowRadius);
  return removeIsolatedLineNoise(bridgeOnePixelLineGaps(closed, width, height), width, height);
}

function floodFillBackground(separatorMask: Uint8Array, width: number, height: number): Uint8Array {
  const total = width * height;
  const background = new Uint8Array(total);
  const queue: number[] = [];
  let qHead = 0;

  const push = (index: number) => {
    if (index < 0 || index >= total || background[index] || separatorMask[index]) return;
    background[index] = 1;
    queue.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }

  while (qHead < queue.length) {
    const index = queue[qHead++];
    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= total) continue;
      const nx = next % width;
      const ny = Math.floor(next / width);
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
      push(next);
    }
  }

  return background;
}

function colorDistance2(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function nearestColorIndex(pixel: Rgb, centers: Rgb[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centers.length; i += 1) {
    const d = colorDistance2(pixel, centers[i]);
    if (d < bestDistance) {
      best = i;
      bestDistance = d;
    }
  }
  return best;
}

function quantizeArtworkColors(image: Uint8ClampedArray, usable: Uint8Array, width: number, height: number, k: number): { labels: Int16Array; centers: Rgb[] } {
  const pixels: Rgb[] = [];
  const stride = Math.max(1, Math.floor((width * height) / 50000));
  for (let i = 0; i < width * height; i += stride) {
    if (!usable[i]) continue;
    const p = i * 4;
    pixels.push({ r: image[p], g: image[p + 1], b: image[p + 2] });
  }

  if (pixels.length === 0) return { labels: new Int16Array(width * height).fill(-1), centers: [] };

  const centers: Rgb[] = [];
  const seedStep = Math.max(1, Math.floor(pixels.length / k));
  for (let i = 0; i < k && centers.length < pixels.length; i += 1) {
    centers.push({ ...pixels[Math.min(pixels.length - 1, i * seedStep)] });
  }
  while (centers.length < k) centers.push({ ...pixels[pixels.length - 1] });

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const sums = centers.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (const pixel of pixels) {
      const index = nearestColorIndex(pixel, centers);
      sums[index].r += pixel.r;
      sums[index].g += pixel.g;
      sums[index].b += pixel.b;
      sums[index].n += 1;
    }
    for (let i = 0; i < centers.length; i += 1) {
      if (sums[i].n === 0) continue;
      centers[i] = { r: sums[i].r / sums[i].n, g: sums[i].g / sums[i].n, b: sums[i].b / sums[i].n };
    }
  }

  const labels = new Int16Array(width * height);
  labels.fill(-1);
  for (let i = 0; i < width * height; i += 1) {
    if (!usable[i]) continue;
    const p = i * 4;
    labels[i] = nearestColorIndex({ r: image[p], g: image[p + 1], b: image[p + 2] }, centers);
  }
  return { labels, centers };
}

function rdp(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length <= 3 || epsilon <= 0) return points;
  const sqEpsilon = epsilon * epsilon;
  const perpendicularDistance2 = (point: Vec2, start: Vec2, end: Vec2) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) {
      const px = point.x - start.x;
      const py = point.y - start.y;
      return px * px + py * py;
    }
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy), 0, 1);
    const x = start.x + t * dx;
    const y = start.y + t * dy;
    const px = point.x - x;
    const py = point.y - y;
    return px * px + py * py;
  };

  const simplify = (startIndex: number, endIndex: number, keep: boolean[]) => {
    let maxDistance = 0;
    let maxIndex = startIndex;
    for (let i = startIndex + 1; i < endIndex; i += 1) {
      const d = perpendicularDistance2(points[i], points[startIndex], points[endIndex]);
      if (d > maxDistance) {
        maxDistance = d;
        maxIndex = i;
      }
    }
    if (maxDistance > sqEpsilon) {
      keep[maxIndex] = true;
      simplify(startIndex, maxIndex, keep);
      simplify(maxIndex, endIndex, keep);
    }
  };

  const closed = points.length > 2 && points[0].x === points[points.length - 1].x && points[0].y === points[points.length - 1].y;
  const work = closed ? points.slice(0, -1) : points;
  if (work.length <= 3) return work;
  const keep = new Array(work.length).fill(false);
  keep[0] = true;
  keep[work.length - 1] = true;
  simplify(0, work.length - 1, keep);
  const simplified = work.filter((_point, index) => keep[index]);
  return simplified.length >= 3 ? simplified : work;
}

function smoothClosedOutline(points: Vec2[], iterations: number): Vec2[] {
  if (points.length < 3 || iterations <= 0) return points;
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

function polygonAreaPx(points: Vec2[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

function outlineFromComponent(pixels: number[], componentMask: Uint8Array, width: number, height: number, simplifyPx: number): Vec2[] {
  const starts = new Map<string, Vec2[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const key = `${ax},${ay}`;
    const list = starts.get(key);
    const value = { x: bx, y: by };
    if (list) list.push(value);
    else starts.set(key, [value]);
  };
  const has = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height && componentMask[y * width + x] === 1;

  for (const index of pixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (!has(x, y - 1)) add(x, y, x + 1, y);
    if (!has(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!has(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!has(x - 1, y)) add(x, y + 1, x, y);
  }

  const loops: Vec2[][] = [];
  while (starts.size > 0) {
    const firstKey = starts.keys().next().value as string;
    const [sx, sy] = firstKey.split(",").map(Number);
    let current = { x: sx, y: sy };
    const loop: Vec2[] = [current];

    for (let guard = 0; guard < pixels.length * 8 + 1000; guard += 1) {
      const key = `${current.x},${current.y}`;
      const options = starts.get(key);
      if (!options || options.length === 0) break;
      const next = options.pop()!;
      if (options.length === 0) starts.delete(key);
      current = next;
      if (current.x === sx && current.y === sy) break;
      loop.push(current);
    }
    if (loop.length >= 3) loops.push(loop);
  }

  const largest = loops.sort((a, b) => polygonAreaPx(b) - polygonAreaPx(a))[0] ?? [];
  return rdp(largest, simplifyPx);
}

function expandComponentIntoLeadMask(
  pixels: number[],
  componentMask: Uint8Array,
  leadMask: Uint8Array,
  width: number,
  height: number,
  radiusPx: number
): number[] {
  if (radiusPx <= 0 || pixels.length === 0) return pixels;

  const expanded = [...pixels];
  const queue = pixels.map((index) => ({ index, distance: 0 }));
  let qHead = 0;

  while (qHead < queue.length) {
    const { index, distance } = queue[qHead++];
    if (distance >= radiusPx) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= width * height || componentMask[next] || !leadMask[next]) continue;
      const nx = next % width;
      const ny = Math.floor(next / width);
      if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;

      componentMask[next] = 1;
      expanded.push(next);
      queue.push({ index: next, distance: distance + 1 });
    }
  }

  return expanded;
}

function traceSolderRegionsFromMask(
  solderMask: Uint8Array,
  pieceIdByPixel: Int32Array,
  width: number,
  height: number,
  minArea: number,
  simplifyPx: number
): TraceSolderRegion[] {
  const total = width * height;
  const visited = new Uint8Array(total);
  const componentMask = new Uint8Array(total);
  const regions: TraceSolderRegion[] = [];
  const queue: number[] = [];
  const minSolderArea = Math.max(3, Math.round(minArea / 3));

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || !solderMask[start]) continue;

    const pixels: number[] = [];
    const adjacentPieces = new Set<number>();
    let touchesEdge = false;
    let qHead = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    while (qHead < queue.length) {
      const index = queue[qHead++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= total) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;

        const pieceId = pieceIdByPixel[next];
        if (pieceId > 0) adjacentPieces.add(pieceId);

        if (visited[next] || !solderMask[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (pixels.length < minSolderArea || adjacentPieces.size === 0) continue;
    if (touchesEdge && adjacentPieces.size < 2) continue;
    if (pixels.length > total * 0.35 && adjacentPieces.size < 3) continue;

    for (const pixel of pixels) componentMask[pixel] = 1;
    const outline = outlineFromComponent(pixels, componentMask, width, height, simplifyPx);
    for (const pixel of pixels) componentMask[pixel] = 0;
    if (outline.length < 3 || polygonAreaPx(outline) < minSolderArea) continue;

    const roundedOutline = smoothClosedOutline(outline, 2);
    regions.push({ outline: roundedOutline, area: polygonAreaPx(roundedOutline) });
  }

  return regions.sort((a, b) => b.area - a.area);
}

function traceEnclosedLineArtPieces(
  image: Uint8ClampedArray,
  solderMask: Uint8Array,
  separatorMask: Uint8Array,
  width: number,
  height: number,
  config: LampConfig
): TraceResult {
  const total = width * height;
  const visited = new Uint8Array(total);
  const componentMask = new Uint8Array(total);
  const pieceIdByPixel = new Int32Array(total);
  const pieces: TracePiece[] = [];
  const minArea = clamp(config.artworkMinPieceAreaPx, 4, 5000);
  const simplifyPx = clamp(config.artworkSimplifyPx, 0, 8);
  const outputWidthMm = clamp(config.artworkWidthMm, 25, 5000);
  const outputHeightMm = clamp(config.artworkHeightMm, 25, 5000);
  const pxPerMm = Math.min(width / outputWidthMm, height / outputHeightMm);
  const seamCenterlineExpansionPx = Math.round(clamp((config.visibleLeadFaceWidthMm / 2) * pxPerMm, 1, 8));
  const queue: number[] = [];

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || separatorMask[start]) continue;
    const p = start * 4;
    if (image[p + 3] / 255 <= 0.03) continue;

    const pixels: number[] = [];
    let qHead = 0;
    let touchesEdge = false;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    while (qHead < queue.length) {
      const index = queue[qHead++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || separatorMask[next]) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        const nextPixel = next * 4;
        if (image[nextPixel + 3] / 255 <= 0.03) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (touchesEdge || pixels.length < minArea) continue;

    for (const pixel of pixels) componentMask[pixel] = 1;
    const centerlinePixels = expandComponentIntoLeadMask(pixels, componentMask, solderMask, width, height, seamCenterlineExpansionPx);
    const outline = outlineFromComponent(centerlinePixels, componentMask, width, height, simplifyPx);
    for (const pixel of centerlinePixels) componentMask[pixel] = 0;
    if (outline.length < 3 || polygonAreaPx(outline) < minArea) continue;

    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const pixel of pixels) {
      const pixelIndex = pixel * 4;
      sr += image[pixelIndex];
      sg += image[pixelIndex + 1];
      sb += image[pixelIndex + 2];
    }
    const n = pixels.length || 1;
    const pieceId = pieces.length + 1;
    for (const pixel of centerlinePixels) pieceIdByPixel[pixel] = pieceId;
    pieces.push({ outline, color: rgbToHex(sr / n, sg / n, sb / n), area: polygonAreaPx(outline) });
  }

  const sortedPieces = pieces.sort((a, b) => {
    const ay = a.outline.reduce((sum, p) => sum + p.y, 0) / a.outline.length;
    const by = b.outline.reduce((sum, p) => sum + p.y, 0) / b.outline.length;
    if (Math.abs(ay - by) > 4) return ay - by;
    const ax = a.outline.reduce((sum, p) => sum + p.x, 0) / a.outline.length;
    const bx = b.outline.reduce((sum, p) => sum + p.x, 0) / b.outline.length;
    return ax - bx;
  });

  return {
    pieces: sortedPieces,
    solderRegions: traceSolderRegionsFromMask(solderMask, pieceIdByPixel, width, height, minArea, simplifyPx)
  };
}

function scaleTracePolygonToMm(points: Vec2[], imageWidth: number, imageHeight: number, outputWidthMm: number, outputHeightMm: number): Vec2[] {
  return points.map((point) => ({
    x: (point.x / imageWidth) * outputWidthMm,
    y: (point.y / imageHeight) * outputHeightMm
  }));
}

function traceDrawingPieces(canvas: HTMLCanvasElement, config: LampConfig): TraceResult {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { pieces: [], solderRegions: [] };

  const { width, height } = canvas;
  const data = context.getImageData(0, 0, width, height).data;
  const total = width * height;
  const threshold = clamp(config.artworkLeadThreshold, 10, 180);
  const solderMask = buildLiquidSolderMask(data, width, height, threshold);
  const separatorMask = dilateMask(solderMask, width, height, Math.max(2, Math.round(Math.min(width, height) / 260)));
  const backgroundMask = floodFillBackground(separatorMask, width, height);
  const usable = new Uint8Array(total);
  let enclosedUsableCount = 0;

  const lineArtTrace = traceEnclosedLineArtPieces(data, solderMask, separatorMask, width, height, config);
  if (lineArtTrace.pieces.length >= 3) {
    return lineArtTrace;
  }

  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    const alpha = data[p + 3] / 255;
    if (!separatorMask[i] && !backgroundMask[i] && alpha > 0.03) {
      usable[i] = 1;
      enclosedUsableCount += 1;
    }
  }

  if (enclosedUsableCount < clamp(config.artworkMinPieceAreaPx, 4, 5000)) {
    for (let i = 0; i < total; i += 1) {
      const p = i * 4;
      const alpha = data[p + 3] / 255;
      usable[i] = !separatorMask[i] && alpha > 0.03 ? 1 : 0;
    }
  }

  const { labels, centers } = quantizeArtworkColors(data, usable, width, height, Math.round(clamp(config.artworkColorCount, 2, 32)));
  const visited = new Uint8Array(total);
  const componentMask = new Uint8Array(total);
  const pieceIdByPixel = new Int32Array(total);
  const pieces: TracePiece[] = [];
  const minArea = clamp(config.artworkMinPieceAreaPx, 4, 5000);
  const simplifyPx = clamp(config.artworkSimplifyPx, 0, 8);
  const outputWidthMm = clamp(config.artworkWidthMm, 25, 5000);
  const outputHeightMm = clamp(config.artworkHeightMm, 25, 5000);
  const pxPerMm = Math.min(width / outputWidthMm, height / outputHeightMm);
  const seamCenterlineExpansionPx = Math.round(clamp((config.visibleLeadFaceWidthMm / 2) * pxPerMm, 1, 6));
  const queue: number[] = [];

  for (let start = 0; start < total; start += 1) {
    if (visited[start] || labels[start] < 0) continue;
    const label = labels[start];
    const pixels: number[] = [];
    let qHead = 0;
    queue.length = 0;
    queue.push(start);
    visited[start] = 1;

    while (qHead < queue.length) {
      const index = queue[qHead++];
      pixels.push(index);
      const x = index % width;
      const y = Math.floor(index / width);
      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || labels[next] !== label) continue;
        const nx = next % width;
        const ny = Math.floor(next / width);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }

    if (pixels.length < minArea) continue;
    for (const pixel of pixels) componentMask[pixel] = 1;
    const centerlinePixels = expandComponentIntoLeadMask(pixels, componentMask, solderMask, width, height, seamCenterlineExpansionPx);
    const outline = outlineFromComponent(centerlinePixels, componentMask, width, height, simplifyPx);
    for (const pixel of centerlinePixels) componentMask[pixel] = 0;
    if (outline.length < 3 || polygonAreaPx(outline) < minArea) continue;

    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (const pixel of pixels) {
      const p = pixel * 4;
      sr += data[p];
      sg += data[p + 1];
      sb += data[p + 2];
    }
    const n = pixels.length || 1;
    const mean = { r: sr / n, g: sg / n, b: sb / n };
    const center = centers[label] ?? mean;
    const rgb = {
      r: Number.isFinite(mean.r) ? mean.r : center.r,
      g: Number.isFinite(mean.g) ? mean.g : center.g,
      b: Number.isFinite(mean.b) ? mean.b : center.b
    };
    const pieceId = pieces.length + 1;
    for (const pixel of centerlinePixels) pieceIdByPixel[pixel] = pieceId;
    pieces.push({ outline, color: rgbToHex(rgb.r, rgb.g, rgb.b), area: polygonAreaPx(outline) });
  }

  const sortedPieces = pieces.sort((a, b) => {
    const ay = a.outline.reduce((sum, p) => sum + p.y, 0) / a.outline.length;
    const by = b.outline.reduce((sum, p) => sum + p.y, 0) / b.outline.length;
    if (Math.abs(ay - by) > 4) return ay - by;
    const ax = a.outline.reduce((sum, p) => sum + p.x, 0) / a.outline.length;
    const bx = b.outline.reduce((sum, p) => sum + p.x, 0) / b.outline.length;
    return ax - bx;
  });
  const solderRegions = traceSolderRegionsFromMask(solderMask, pieceIdByPixel, width, height, minArea, simplifyPx);
  return { pieces: sortedPieces, solderRegions };
}

export async function rasterPaintingToFlatPattern(file: File, config: LampConfig): Promise<FlatPatternDocument> {
  const canvas = await imageFileToCanvas(file);
  const outputWidth = clamp(config.artworkWidthMm, 25, 5000);
  const outputHeight = clamp(config.artworkHeightMm, 25, 5000);

  if (config.artworkTraceDrawing) {
    const trace = traceDrawingPieces(canvas, config);
    if (trace.pieces.length > 0) {
      const outlines: FlatOutlineInput[] = trace.pieces.map((piece, index) => ({
        id: `T${index + 1}`,
        color: piece.color,
        outline: scaleTracePolygonToMm(piece.outline, canvas.width, canvas.height, outputWidth, outputHeight)
      }));
      const solderRegions: NonNullable<FlatPatternDocument["solderRegions"]> = trace.solderRegions.map((region, index) => ({
        id: `SOLDER${index + 1}`,
        outline: scaleTracePolygonToMm(region.outline, canvas.width, canvas.height, outputWidth, outputHeight)
      }));

      return createFlatPatternDocument(
        `Traced stained glass from ${file.name}`,
        "Raster artwork traced with CoopGlass-style detection: glass pieces are extracted first, then dark separator regions are filled as flowed solder/lead while cuts remain inset for fit.",
        outlines,
        glassInsetFromConfig(config),
        {
          sourceFile: file.name,
          sourceType: "raster drawing trace",
          detectionEngine: "glass-first tracing with liquid solder-mask fill and seam-centerline reconstruction",
          fitModel: "glass pieces are cut from seam centerlines inset by half the came heart plus fit tolerance",
          solderFillModel: "dark separator regions touching glass are rendered as flowed solder fills",
          outputWidthMm: fmt(outputWidth),
          outputHeightMm: fmt(outputHeight),
          detectedPieces: outlines.length,
          detectedSolderRegions: solderRegions.length,
          detectedColorFamilies: Math.round(clamp(config.artworkColorCount, 2, 32)),
          leadLumaThreshold: Math.round(clamp(config.artworkLeadThreshold, 10, 180)),
          minPieceAreaPx: Math.round(clamp(config.artworkMinPieceAreaPx, 4, 5000)),
          traceSimplifyPx: fmt(clamp(config.artworkSimplifyPx, 0, 8))
        },
        [],
        solderRegions
      );
    }
  }

  const panelCount = Math.round(clamp(config.artworkPanelCount, 8, 800));
  const relaxations = Math.round(clamp(config.artworkRelaxations, 0, 8));
  const seeds = relaxSeeds(canvas, initializeSeeds(canvas.width, canvas.height, panelCount), relaxations);
  const cells = voronoiCells(canvas.width, canvas.height, seeds);

  const outlines: FlatOutlineInput[] = cells
    .map((cell, index) => ({
      id: `A${index + 1}`,
      color: seeds[index]?.color ?? PALETTE_FALLBACK[index % PALETTE_FALLBACK.length],
      outline: scalePolygonToMm(cell, canvas.width, canvas.height, outputWidth, outputHeight)
    }))
    .filter((outline) => outline.outline.length >= 3);

  return createFlatPatternDocument(
    `Stained glass mosaic from ${file.name}`,
    "Raster artwork converted into a Voronoi-style stained-glass mosaic fallback. Exported cut lines include came allowance.",
    outlines,
    glassInsetFromConfig(config),
    {
      sourceFile: file.name,
      sourceType: "raster painting fallback",
      outputWidthMm: fmt(outputWidth),
      outputHeightMm: fmt(outputHeight),
      requestedPanelCount: panelCount,
      relaxationPasses: relaxations
    }
  );
}
