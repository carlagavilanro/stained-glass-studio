import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { FlatPatternDocument, LampConfig, MeshEdge, MeshFacet, MeshFacetProject, Pattern, Seam, UV, Vec2, Vec3Tuple } from "../types";
import { FrustumSurface } from "../geometry/frustumSurface";
import { createFlatPanels, glassInsetFromConfig, sampleUvPolylineToFlat } from "../geometry/flatLayout";
import { offsetPolygonInwardRobust } from "../geometry/clipperOffset";
import { boundsOf, removeNearDuplicatePoints } from "../geometry/math";

function sampleUvFor3D(surface: FrustumSurface, uv: UV[], targetSegmentLengthMm = 8): UV[] {
  if (uv.length < 2) return uv;

  const sampled: UV[] = [];
  for (let i = 0; i < uv.length; i += 1) {
    const a = uv[i];
    const b = uv[(i + 1) % uv.length];
    const radius = surface.radiusAtZ((a.z + b.z) / 2);
    const length = Math.hypot(Math.abs(b.theta - a.theta) * radius, Math.abs(b.z - a.z));
    const steps = Math.max(1, Math.ceil(length / targetSegmentLengthMm));
    for (let step = 0; step < steps; step += 1) {
      sampled.push(surface.uvLerp(a, b, step / steps));
    }
  }
  return sampled;
}

function averageUv(uv: UV[]): UV {
  const sum = uv.reduce(
    (acc, point) => ({ theta: acc.theta + point.theta, z: acc.z + point.z }),
    { theta: 0, z: 0 }
  );
  return { theta: sum.theta / uv.length, z: sum.z / uv.length };
}

function buildUvGeometry(surface: FrustumSurface, outlineUv: UV[], normalOffsetMm: number): THREE.BufferGeometry {
  const boundaryUv = sampleUvFor3D(surface, outlineUv, 7);
  const center = surface.uvToPoint(averageUv(outlineUv), normalOffsetMm);
  const positions: number[] = [center.x, center.y, center.z];

  for (const uv of boundaryUv) {
    const point = surface.uvToPoint(uv, normalOffsetMm);
    positions.push(point.x, point.y, point.z);
  }

  const indices: number[] = [];
  for (let i = 1; i <= boundaryUv.length; i += 1) {
    indices.push(0, i, i === boundaryUv.length ? 1 : i + 1);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function seamPoints3D(surface: FrustumSurface, seam: Seam, normalOffsetMm: number): THREE.Vector3[] {
  const sampled: THREE.Vector3[] = [];
  for (let i = 0; i < seam.uv.length - 1; i += 1) {
    const a = seam.uv[i];
    const b = seam.uv[i + 1];
    const radius = surface.radiusAtZ((a.z + b.z) / 2);
    const length = Math.hypot(Math.abs(b.theta - a.theta) * radius, Math.abs(b.z - a.z));
    const steps = Math.max(1, Math.ceil(length / 7));
    for (let step = 0; step < steps; step += 1) {
      sampled.push(surface.uvToPoint(surface.uvLerp(a, b, step / steps), normalOffsetMm));
    }
  }
  sampled.push(surface.uvToPoint(seam.uv[seam.uv.length - 1], normalOffsetMm));

  if (seam.closed && sampled.length > 1 && sampled[0].distanceTo(sampled[sampled.length - 1]) < 1e-5) {
    sampled.pop();
  }

  return sampled;
}

function disposeObject3D(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else if (material) {
      material.dispose();
    }
  });
}

function tupleToVector(tuple: Vec3Tuple): THREE.Vector3 {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function createLineLoop(points: Vec2[], material: THREE.LineBasicMaterial, y: number): THREE.LineLoop {
  const positions = points.flatMap((point) => [point.x, y, point.y]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineLoop(geometry, material);
}

function shapeFromPoints(points: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length === 0) return shape;
  shape.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) shape.lineTo(points[i].x, points[i].y);
  shape.closePath();
  return shape;
}

function roundedShapeFromPoints(points: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length < 3) return shapeFromPoints(points);

  const midpoint = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = midpoint(points[points.length - 1], points[0]);
  shape.moveTo(start.x, start.y);

  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const end = midpoint(current, next);
    shape.quadraticCurveTo(current.x, current.y, end.x, end.y);
  }

  shape.closePath();
  return shape;
}

function centerFlatPoints(points: Vec2[], centerX: number, centerY: number): Vec2[] {
  return points.map((point) => ({ x: point.x - centerX, y: point.y - centerY }));
}

function makeTubeBetween(a: THREE.Vector3, b: THREE.Vector3, radius: number): THREE.BufferGeometry | null {
  if (a.distanceTo(b) < 1e-6) return null;
  const curve = new THREE.LineCurve3(a, b);
  return new THREE.TubeGeometry(curve, 12, radius, 20, false);
}

function makeRoundedSolderTube(points: THREE.Vector3[], radius: number, closed: boolean): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  if (points.length === 2 && !closed) return makeTubeBetween(points[0], points[1], radius);
  const curve = new THREE.CatmullRomCurve3(points, closed, "centripetal");
  return new THREE.TubeGeometry(curve, Math.max(points.length * 6, 40), radius, 20, closed);
}

function triangleOutlineToFlat(vertices: THREE.Vector3[]): Vec2[] {
  if (vertices.length !== 3) return [];
  const [a, b, c] = vertices;
  const ab = a.distanceTo(b);
  const ac = a.distanceTo(c);
  const bc = b.distanceTo(c);
  if (ab < 1e-8 || ac < 1e-8 || bc < 1e-8) return [];

  const cx = (ac * ac + ab * ab - bc * bc) / (2 * ab);
  const cy = Math.sqrt(Math.max(0, ac * ac - cx * cx));
  return [
    { x: 0, y: 0 },
    { x: ab, y: 0 },
    { x: cx, y: cy }
  ];
}

function barycentricWeights(point: Vec2, triangle: Vec2[]): [number, number, number] | null {
  if (triangle.length !== 3) return null;
  const [a, b, c] = triangle;
  const denominator = ((b.y - c.y) * (a.x - c.x)) + ((c.x - b.x) * (a.y - c.y));
  if (Math.abs(denominator) < 1e-8) return null;

  const w1 = (((b.y - c.y) * (point.x - c.x)) + ((c.x - b.x) * (point.y - c.y))) / denominator;
  const w2 = (((c.y - a.y) * (point.x - c.x)) + ((a.x - c.x) * (point.y - c.y))) / denominator;
  const w3 = 1 - w1 - w2;
  return [w1, w2, w3];
}

function mapFlatPointToTriangle(point: Vec2, flatTriangle: Vec2[], worldTriangle: THREE.Vector3[]): THREE.Vector3 | null {
  const weights = barycentricWeights(point, flatTriangle);
  if (!weights || worldTriangle.length !== 3) return null;
  return worldTriangle[0].clone().multiplyScalar(weights[0])
    .add(worldTriangle[1].clone().multiplyScalar(weights[1]))
    .add(worldTriangle[2].clone().multiplyScalar(weights[2]));
}

type FlatSeamRun = {
  points: Vec2[];
  closed: boolean;
};

function flatPointKey(point: Vec2, precision = 1000): string {
  return `${Math.round(point.x * precision)},${Math.round(point.y * precision)}`;
}

function createFlatSeamRuns(seams: FlatPatternDocument["seams"], centerX: number, centerY: number): FlatSeamRun[] {
  const runs: FlatSeamRun[] = [];
  const nodes = new Map<string, Vec2>();
  const edges: { a: string; b: string; used: boolean }[] = [];
  const adjacency = new Map<string, number[]>();

  const addNode = (point: Vec2) => {
    const key = flatPointKey(point);
    if (!nodes.has(key)) nodes.set(key, point);
    return key;
  };

  const addEdge = (a: Vec2, b: Vec2) => {
    const aKey = addNode(a);
    const bKey = addNode(b);
    if (aKey === bKey) return;
    const edgeIndex = edges.length;
    edges.push({ a: aKey, b: bKey, used: false });
    adjacency.set(aKey, [...(adjacency.get(aKey) ?? []), edgeIndex]);
    adjacency.set(bKey, [...(adjacency.get(bKey) ?? []), edgeIndex]);
  };

  for (const seam of seams) {
    const cleaned = removeNearDuplicatePoints(centerFlatPoints(seam.points, centerX, centerY));
    if (cleaned.length < 2) continue;

    if (seam.closed || cleaned.length > 2) {
      runs.push({ points: cleaned, closed: Boolean(seam.closed && cleaned.length > 2) });
      continue;
    }

    addEdge(cleaned[0], cleaned[1]);
  }

  const nextUnusedEdge = (key: string) => (adjacency.get(key) ?? []).find((edgeIndex) => !edges[edgeIndex].used);
  const walk = (startKey: string): FlatSeamRun | null => {
    const points: Vec2[] = [nodes.get(startKey)!];
    let currentKey = startKey;
    let previousKey = "";

    for (let guard = 0; guard < edges.length + 2; guard += 1) {
      const edgeIndex = (adjacency.get(currentKey) ?? []).find((candidate) => {
        const edge = edges[candidate];
        if (edge.used) return false;
        const nextKey = edge.a === currentKey ? edge.b : edge.a;
        return nextKey !== previousKey || (adjacency.get(currentKey) ?? []).filter((index) => !edges[index].used).length === 1;
      });

      if (edgeIndex === undefined) break;
      const edge = edges[edgeIndex];
      edge.used = true;
      const nextKey = edge.a === currentKey ? edge.b : edge.a;
      points.push(nodes.get(nextKey)!);

      if (nextKey === startKey) {
        points.pop();
        return points.length >= 3 ? { points, closed: true } : null;
      }

      previousKey = currentKey;
      currentKey = nextKey;

      const degree = adjacency.get(currentKey)?.length ?? 0;
      if (degree !== 2) break;
    }

    return points.length >= 2 ? { points, closed: false } : null;
  };

  const starts = [...nodes.keys()].filter((key) => (adjacency.get(key)?.length ?? 0) !== 2);
  for (const start of starts) {
    while (nextUnusedEdge(start) !== undefined) {
      const run = walk(start);
      if (run) runs.push(run);
    }
  }

  for (const edge of edges) {
    if (edge.used) continue;
    const run = walk(edge.a);
    if (run) runs.push(run);
  }

  return runs;
}

function createFlatSeamTubes(seams: FlatPatternDocument["seams"], centerX: number, centerY: number, y: number, radius: number, material: THREE.Material): THREE.Object3D {
  const group = new THREE.Group();
  for (const run of createFlatSeamRuns(seams, centerX, centerY)) {
    const points = run.points.map((point) => new THREE.Vector3(point.x, y, point.y));
    const geometry = makeRoundedSolderTube(points, radius, run.closed);
    if (geometry) group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

export class LampScene {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly scene = new THREE.Scene();
  private readonly generated = new THREE.Group();
  private readonly toast: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
    this.camera.position.set(420, 260, 420);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 120, 0);

    this.scene.add(this.generated);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1b2030, 2.4));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
    keyLight.position.set(300, 600, 220);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb8d5ff, 1.2);
    fillLight.position.set(-300, 220, -300);
    this.scene.add(fillLight);

    const grid = new THREE.GridHelper(900, 18, 0x516077, 0x2b3342);
    grid.position.y = -0.5;
    this.scene.add(grid);

    this.toast = document.createElement("div");
    this.toast.id = "toast";
    this.container.appendChild(this.toast);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.render());
  }

  showMessage(message: string): void {
    this.toast.textContent = message;
    this.toast.classList.add("visible");
    window.setTimeout(() => this.toast.classList.remove("visible"), 3200);
  }

  private viewportColor(color: number): string {
    return `#${new THREE.Color(color).getHexString()}`;
  }

  private setViewportBackground(edgeHighlight: number, edgeShadow: number): void {
    const highlight = new THREE.Color(edgeHighlight);
    const shadow = new THREE.Color(edgeShadow);
    const glow = highlight.clone().lerp(new THREE.Color(0xffffff), 0.2);
    const mid = highlight.clone().lerp(shadow, 0.42);
    const base = shadow.clone().lerp(new THREE.Color(0x11151d), 0.66);
    const deep = shadow.clone().lerp(new THREE.Color(0x05070b), 0.78);

    this.container.style.setProperty(
      "--viewport-background",
      `radial-gradient(circle at 50% 36%, ${this.viewportColor(glow.getHex())} 0%, ${this.viewportColor(mid.getHex())} 28%, ${this.viewportColor(base.getHex())} 62%, ${this.viewportColor(deep.getHex())} 100%)`
    );
  }

  private syncViewportBackground(config: LampConfig, flatMode = false): void {
    if (config.showLead && config.showMold) {
      this.setViewportBackground(0xbfc9d9, 0x4d5156);
      return;
    }

    if (config.showLead) {
      this.setViewportBackground(0x94a3b8, 0x4d5156);
      return;
    }

    if (config.showMold) {
      this.setViewportBackground(0xbfc9d9, 0x516077);
      return;
    }

    if (flatMode || config.showFlatReference) {
      this.setViewportBackground(0xffffff, 0x516077);
      return;
    }

    this.setViewportBackground(0xb8d5ff, 0x293241);
  }

  update(config: LampConfig, pattern: Pattern, surface: FrustumSurface): void {
    this.resetGenerated();
    this.syncViewportBackground(config);

    if (config.showMold) {
      this.generated.add(this.createMold(config));
    }

    if (config.showGlass) {
      this.generated.add(this.createGlass(config, pattern, surface));
    }

    if (config.showLead) {
      this.generated.add(this.createLead(config, pattern, surface));
    }

    if (config.showFlatReference) {
      this.generated.add(this.createFlatReference(config, pattern, surface));
    }

    this.camera.position.set(420, 260, 420);
    this.controls.target.set(0, config.heightMm / 2, 0);
  }

  updateFlatPattern(config: LampConfig, document: FlatPatternDocument): void {
    this.resetGenerated();
    this.syncViewportBackground(config, true);
    this.generated.add(this.createFlatPatternPreview(config, document));
    this.frameFlatDocument(document);
  }

  updateMeshProject(config: LampConfig, project: MeshFacetProject): void {
    this.resetGenerated();
    this.syncViewportBackground(config);

    if (config.showMold) this.generated.add(this.createMeshWireGuide(project.edges));
    if (config.showGlass) this.generated.add(this.createMeshFacets(config, project.facets));
    if (config.showLead) this.generated.add(this.createMeshLead(config, project.edges));
    if (config.showFlatReference) this.generated.add(this.createFlatPatternReferenceFromDocument(project.flatPattern, -8, 0.28));

    this.frameMeshProject(project);
  }

  private resetGenerated(): void {
    disposeObject3D(this.generated);
    this.generated.clear();
  }

  private createMold(config: LampConfig): THREE.Object3D {
    const geometry = new THREE.CylinderGeometry(
      config.topRadiusMm,
      config.bottomRadiusMm,
      config.heightMm,
      144,
      12,
      true
    );
    geometry.translate(0, config.heightMm / 2, 0);

    const material = new THREE.MeshStandardMaterial({
      color: 0x8f9daf,
      transparent: true,
      opacity: 0.23,
      roughness: 0.72,
      metalness: 0.0,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "transparent-mold";

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xbfc9d9, transparent: true, opacity: 0.16 })
    );
    wire.name = "mold-wireframe";

    const group = new THREE.Group();
    group.add(mesh, wire);
    return group;
  }

  private createGlass(config: LampConfig, pattern: Pattern, surface: FrustumSurface): THREE.Object3D {
    const group = new THREE.Group();
    const offset = config.moldOffsetMm + config.glassThicknessMm / 2;
    const flatPanels = createFlatPanels(pattern, surface, glassInsetFromConfig(config));

    for (let index = 0; index < pattern.panels.length; index += 1) {
      const panel = pattern.panels[index];
      const flatPanel = flatPanels[index];
      const material = this.glassMaterial(panel.color, config);
      const contours = flatPanel?.glassCutOutlines.length ? flatPanel.glassCutOutlines : [];

      for (const contour of contours) {
        const contourUv = contour.map((point) => surface.flatToUv(point));
        if (contourUv.length < 3) continue;
        const mesh = new THREE.Mesh(buildUvGeometry(surface, contourUv, offset), material);
        mesh.name = `glass-${panel.id}`;
        group.add(mesh);
      }
    }

    return group;
  }

  private glassMaterial(color: string, config: LampConfig): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(color),
      metalness: 0,
      roughness: 0.08,
      transparent: true,
      opacity: 0.68,
      transmission: 0.35,
      thickness: config.glassThicknessMm,
      ior: 1.5,
      side: THREE.DoubleSide,
      depthWrite: false
    });
  }

  private leadMaterial(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: 0x4d5156,
      metalness: 1,
      roughness: 0.32
    });
  }

  private createLead(config: LampConfig, pattern: Pattern, surface: FrustumSurface): THREE.Object3D {
    const group = new THREE.Group();
    const material = this.leadMaterial();
    const radius = config.visibleLeadFaceWidthMm / 2;
    const offset = config.moldOffsetMm + config.glassThicknessMm + radius * 0.52;

    for (const seam of pattern.seams) {
      const points = seamPoints3D(surface, seam, offset);
      if (points.length < 2) continue;
      const geometry = makeRoundedSolderTube(points, radius, Boolean(seam.closed));
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `lead-${seam.id}`;
      group.add(mesh);
    }

    return group;
  }

  private createFlatReference(config: LampConfig, pattern: Pattern, surface: FrustumSurface): THREE.Object3D {
    const glassInsetMm = glassInsetFromConfig(config);
    const flatPanels = createFlatPanels(pattern, surface, glassInsetMm);
    const document: FlatPatternDocument = {
      title: "Flat reference",
      description: "Preview-only flat reference",
      units: "mm",
      panels: flatPanels,
      seams: pattern.seams.map((seam) => ({ id: seam.id, points: sampleUvPolylineToFlat(surface, seam.uv), closed: seam.closed })),
      metadata: {}
    };
    const group = this.createFlatPatternReferenceFromDocument(document, -8, 0.55);
    group.position.set(0, -24, -360);
    return group;
  }

  private createFlatPatternReferenceFromDocument(document: FlatPatternDocument, y: number, scale: number): THREE.Object3D {
    const group = new THREE.Group();
    const allPoints = document.panels.flatMap((panel) => panel.glassCutOutlines.flat());
    const bounds = boundsOf(allPoints.length > 0 ? allPoints : document.panels.flatMap((panel) => panel.centerlineOutline));
    const material = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 });
    const seamMaterial = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.24 });
    const centerX = bounds.min.x + bounds.width / 2;
    const centerY = bounds.min.y + bounds.height / 2;

    for (const panel of document.panels) {
      for (const outline of panel.glassCutOutlines.length ? panel.glassCutOutlines : [panel.centerlineOutline]) {
        group.add(createLineLoop(centerFlatPoints(outline, centerX, centerY), material, y));
      }
    }

    for (const seam of document.seams) {
      const points = centerFlatPoints(seam.points, centerX, centerY);
      const cleaned = removeNearDuplicatePoints(points);
      if (cleaned.length < 2) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(cleaned.flatMap((p) => [p.x, y + 1, p.y]), 3));
      group.add(seam.closed ? new THREE.LineLoop(geometry, seamMaterial) : new THREE.Line(geometry, seamMaterial));
    }

    group.scale.setScalar(scale);
    group.name = "flat-reference-layout";
    return group;
  }

  private createFlatPatternPreview(config: LampConfig, document: FlatPatternDocument): THREE.Object3D {
    const group = new THREE.Group();
    const allPoints = document.panels.flatMap((panel) => panel.centerlineOutline);
    const bounds = boundsOf(allPoints);
    const centerX = bounds.min.x + bounds.width / 2;
    const centerY = bounds.min.y + bounds.height / 2;
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16 });
    const leadMaterial = this.leadMaterial();
    const leadRadius = config.visibleLeadFaceWidthMm / 2;

    for (const panel of document.panels) {
      for (const outline of panel.glassCutOutlines.length ? panel.glassCutOutlines : [panel.centerlineOutline]) {
        const centered = centerFlatPoints(outline, centerX, centerY);
        const shape = shapeFromPoints(centered);
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, this.glassMaterial(panel.color, config));
        mesh.position.y = config.glassThicknessMm / 2;
        mesh.name = `flat-glass-${panel.id}`;
        group.add(mesh);
        group.add(createLineLoop(centered, outlineMaterial, config.glassThicknessMm + 0.2));
      }
    }

    if (config.showLead) {
      const leadY = config.glassThicknessMm + leadRadius * 0.55;
      for (const region of document.solderRegions ?? []) {
        const centered = centerFlatPoints(region.outline, centerX, centerY);
        if (centered.length < 3) continue;
        const shape = roundedShapeFromPoints(centered);
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, leadMaterial);
        mesh.position.y = config.glassThicknessMm + 0.08;
        mesh.name = `flat-solder-fill-${region.id}`;
        group.add(mesh);
      }
      group.add(createFlatSeamTubes(document.seams, centerX, centerY, leadY, leadRadius, leadMaterial));
    }

    group.name = "flat-artwork-preview";
    return group;
  }

  private createMeshFacets(config: LampConfig, facets: MeshFacet[]): THREE.Object3D {
    const group = new THREE.Group();
    const offset = config.moldOffsetMm + config.glassThicknessMm / 2;
    const glassInsetMm = glassInsetFromConfig(config);

    for (const facet of facets) {
      const baseVertices = facet.vertices.map((tuple) => tupleToVector(tuple));
      const normal = tupleToVector(facet.normal);
      const localTriangle = triangleOutlineToFlat(baseVertices);
      const cutOutline = offsetPolygonInwardRobust(localTriangle, glassInsetMm);
      if (cutOutline.length < 3) continue;

      const vertices = cutOutline
        .map((point) => mapFlatPointToTriangle(point, localTriangle, baseVertices))
        .filter((point): point is THREE.Vector3 => Boolean(point))
        .map((point) => point.add(normal.clone().multiplyScalar(offset)));
      if (vertices.length < 3) continue;

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flatMap((v) => [v.x, v.y, v.z]), 3));
      const indices: number[] = [];
      for (let i = 1; i < vertices.length - 1; i += 1) {
        indices.push(0, i, i + 1);
      }
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, this.glassMaterial(facet.color, config));
      mesh.name = `mesh-facet-${facet.id}`;
      group.add(mesh);
    }

    return group;
  }

  private createMeshWireGuide(edges: MeshEdge[]): THREE.Object3D {
    const positions = edges.flatMap((edge) => [...edge.a, ...edge.b]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color: 0xbfc9d9, transparent: true, opacity: 0.25 });
    const lines = new THREE.LineSegments(geometry, material);
    lines.name = "mesh-wire-guide";
    return lines;
  }

  private createMeshLead(config: LampConfig, edges: MeshEdge[]): THREE.Object3D {
    const group = new THREE.Group();
    const material = this.leadMaterial();
    const radius = config.visibleLeadFaceWidthMm / 2;
    const offset = config.moldOffsetMm + config.glassThicknessMm + radius * 0.52;

    for (const edge of edges) {
      const normalOffset = tupleToVector(edge.normal).multiplyScalar(offset);
      const a = tupleToVector(edge.a).add(normalOffset);
      const b = tupleToVector(edge.b).add(normalOffset);
      const geometry = makeTubeBetween(
        a,
        b,
        radius
      );
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `mesh-lead-${edge.id}`;
      group.add(mesh);
    }
    return group;
  }

  private frameFlatDocument(document: FlatPatternDocument): void {
    const points = document.panels.flatMap((panel) => panel.centerlineOutline);
    const bounds = boundsOf(points);
    const size = Math.max(bounds.width, bounds.height, 100);
    this.camera.position.set(size * 0.65, size * 0.95, size * 0.9);
    this.controls.target.set(0, 0, 0);
  }

  private frameMeshProject(project: MeshFacetProject): void {
    const size = Math.max(project.sourceBoundsMm.width, project.sourceBoundsMm.height, project.sourceBoundsMm.depth, 100);
    this.camera.position.set(size * 1.4, size * 0.9, size * 1.4);
    this.controls.target.set(0, 0, 0);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.renderer.setSize(rect.width, rect.height, false);
    this.camera.aspect = rect.width / Math.max(rect.height, 1);
    this.camera.updateProjectionMatrix();
  }

  private render(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
