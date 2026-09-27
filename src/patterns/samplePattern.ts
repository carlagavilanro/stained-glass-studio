import type { LampConfig, Panel, Pattern, Seam, UV } from "../types";
import { degToRad, lerp } from "../geometry/math";

const GLASS_PALETTE = [
  "#d64f4f",
  "#f0b14b",
  "#f7e06e",
  "#6fbf73",
  "#4fb5d6",
  "#7567d9",
  "#c45bc8",
  "#f28ab2"
];

function boundaryTheta(index: number, zNorm: number, config: LampConfig): number {
  const segmentAngle = (Math.PI * 2) / config.radialSegments;
  const amplitude = Math.min(Math.abs(degToRad(config.waveAmplitudeDeg)), segmentAngle * 0.35);
  const base = segmentAngle * index;
  const phaseIndex = ((index % config.radialSegments) + config.radialSegments) % config.radialSegments;
  const phase = (phaseIndex * Math.PI * 2) / config.radialSegments;
  return base + amplitude * Math.sin(Math.PI * 2 * config.waveCycles * zNorm + phase);
}

function pushIfDifferent(points: UV[], point: UV): void {
  const previous = points[points.length - 1];
  if (!previous || Math.abs(previous.theta - point.theta) > 1e-8 || Math.abs(previous.z - point.z) > 1e-8) {
    points.push(point);
  }
}

function panelPolygon(radialIndex: number, bandIndex: number, config: LampConfig): UV[] {
  const z0 = (bandIndex / config.bands) * config.heightMm;
  const z1 = ((bandIndex + 1) / config.bands) * config.heightMm;
  const z0n = bandIndex / config.bands;
  const z1n = (bandIndex + 1) / config.bands;
  const sideSamples = Math.max(3, Math.ceil(config.waveCycles * 6));
  const points: UV[] = [];

  pushIfDifferent(points, { theta: boundaryTheta(radialIndex, z0n, config), z: z0 });
  pushIfDifferent(points, { theta: boundaryTheta(radialIndex + 1, z0n, config), z: z0 });

  for (let sample = 1; sample <= sideSamples; sample += 1) {
    const t = sample / sideSamples;
    const zNorm = lerp(z0n, z1n, t);
    pushIfDifferent(points, {
      theta: boundaryTheta(radialIndex + 1, zNorm, config),
      z: lerp(z0, z1, t)
    });
  }

  pushIfDifferent(points, { theta: boundaryTheta(radialIndex, z1n, config), z: z1 });

  for (let sample = sideSamples - 1; sample >= 0; sample -= 1) {
    const t = sample / sideSamples;
    const zNorm = lerp(z0n, z1n, t);
    pushIfDifferent(points, {
      theta: boundaryTheta(radialIndex, zNorm, config),
      z: lerp(z0, z1, t)
    });
  }

  return points;
}

function verticalSeam(radialIndex: number, config: LampConfig): Seam {
  const samples = Math.max(12, config.bands * 8, Math.ceil(config.waveCycles * 24));
  const uv: UV[] = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    const zNorm = sample / samples;
    uv.push({
      theta: boundaryTheta(radialIndex, zNorm, config),
      z: zNorm * config.heightMm
    });
  }

  return {
    id: `V${radialIndex + 1}`,
    kind: radialIndex === 0 ? "boundary" : "vertical",
    uv
  };
}

function horizontalSeam(bandIndex: number, config: LampConfig): Seam {
  const samples = Math.max(96, config.radialSegments * 6);
  const z = (bandIndex / config.bands) * config.heightMm;
  const uv: UV[] = [];
  for (let sample = 0; sample <= samples; sample += 1) {
    uv.push({ theta: (sample / samples) * Math.PI * 2, z });
  }

  return {
    id: `H${bandIndex}`,
    kind: bandIndex === 0 || bandIndex === config.bands ? "boundary" : "horizontal",
    uv,
    closed: true
  };
}

export function createPattern(config: LampConfig): Pattern {
  const panels: Panel[] = [];
  for (let band = 0; band < config.bands; band += 1) {
    for (let radial = 0; radial < config.radialSegments; radial += 1) {
      panels.push({
        id: `P${band + 1}-${radial + 1}`,
        color: GLASS_PALETTE[(band * 3 + radial) % GLASS_PALETTE.length],
        uv: panelPolygon(radial, band, config)
      });
    }
  }

  const seams: Seam[] = [];
  for (let radial = 0; radial < config.radialSegments; radial += 1) {
    seams.push(verticalSeam(radial, config));
  }
  for (let band = 0; band <= config.bands; band += 1) {
    seams.push(horizontalSeam(band, config));
  }

  return { panels, seams };
}
