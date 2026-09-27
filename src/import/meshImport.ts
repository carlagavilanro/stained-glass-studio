import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import type { LampConfig, MeshEdge, MeshFacet, MeshFacetProject, Vec2, Vec3Tuple } from "../types";
import { boundsOf, clamp, fmt, signedArea } from "../geometry/math";
import { offsetPolygonInwardRobust } from "../geometry/clipperOffset";
import { createFlatPatternDocument, type FlatOutlineInput } from "../geometry/flatPattern";
import { glassInsetFromConfig } from "../geometry/flatLayout";

const FACET_COLORS = ["#d64f4f", "#f0b14b", "#f7e06e", "#6fbf73", "#4fb5d6", "#7567d9", "#c45bc8", "#f28ab2"];

type Triangle = {
  vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  color: string;
};

const MESH_EXTENSIONS = new Set(["obj", "stl", "glb", "gltf"]);

function extensionOf(file: File): string {
  return file.name.split(".").pop()?.toLowerCase() ?? "";
}

function normalizeResourcePath(value: string): string {
  return decodeURIComponent(value.split(/[?#]/)[0] ?? "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .toLowerCase();
}

function basename(value: string): string {
  const normalized = normalizeResourcePath(value);
  return normalized.split("/").pop() ?? normalized;
}

function fileResourceNames(file: File): string[] {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return [file.name, relativePath].filter((name): name is string => Boolean(name));
}

function choosePrimaryMeshFile(files: File[]): File {
  const primary = files.find((file) => MESH_EXTENSIONS.has(extensionOf(file)));
  if (!primary) {
    throw new Error("No mesh file was selected. Choose an OBJ, STL, GLB, or GLTF file.");
  }
  return primary;
}

function createLocalLoadingManager(files: File[]): { manager: THREE.LoadingManager; objectUrls: string[] } {
  const localResources = new Map<string, File>();
  const objectUrls: string[] = [];

  for (const file of files) {
    for (const name of fileResourceNames(file)) {
      const normalized = normalizeResourcePath(name);
      localResources.set(normalized, file);
      localResources.set(basename(normalized), file);
    }
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(blob:|data:|file:)/i.test(url)) return url;

    const normalized = normalizeResourcePath(url);
    const localFile = localResources.get(normalized) ?? localResources.get(basename(normalized));
    if (!localFile) return url;

    const objectUrl = URL.createObjectURL(localFile);
    objectUrls.push(objectUrl);
    return objectUrl;
  });

  return { manager, objectUrls };
}

function vecToTuple(vector: THREE.Vector3): Vec3Tuple {
  return [vector.x, vector.y, vector.z];
}

function colorFromMaterial(material: THREE.Material | THREE.Material[] | undefined, fallback: string): string {
  const first = Array.isArray(material) ? material[0] : material;
  const color = (first as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial | undefined)?.color;
  return color ? `#${color.getHexString()}` : fallback;
}

function parseGltf(data: ArrayBuffer | string, files: File[]): Promise<THREE.Object3D> {
  const { manager, objectUrls } = createLocalLoadingManager(files);
  const loader = new GLTFLoader(manager);

  return new Promise((resolve, reject) => {
    loader.parse(
      data,
      "",
      (gltf) => {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        resolve(gltf.scene);
      },
      (error) => {
        objectUrls.forEach((url) => URL.revokeObjectURL(url));
        const detail = error instanceof Error ? error.message : String(error);
        reject(new Error(`GLTF import failed. For .gltf files with external .bin or texture resources, select every referenced local file at the same time. ${detail}`));
      }
    );
  });
}

async function fileToObject3D(filesOrFile: File[] | File): Promise<THREE.Object3D> {
  const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];
  const file = choosePrimaryMeshFile(files);
  const extension = extensionOf(file);

  if (extension === "obj") {
    const text = await file.text();
    return new OBJLoader().parse(text);
  }

  if (extension === "stl") {
    const buffer = await file.arrayBuffer();
    const geometry = new STLLoader().parse(buffer);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x7aa5ff }));
    const group = new THREE.Group();
    group.add(mesh);
    return group;
  }

  if (extension === "glb") {
    return parseGltf(await file.arrayBuffer(), files);
  }

  if (extension === "gltf") {
    return parseGltf(await file.text(), files);
  }

  throw new Error("Unsupported 3D mesh format. Use OBJ, STL, GLB, or GLTF.");
}

function extractTriangles(root: THREE.Object3D, scaleMm: number, maxFacets: number): Triangle[] {
  const triangles: Triangle[] = [];

  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (triangles.length >= maxFacets) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    const position = geometry.getAttribute("position");
    if (!position) return;

    const color = colorFromMaterial(mesh.material, FACET_COLORS[triangles.length % FACET_COLORS.length]);
    const matrix = mesh.matrixWorld.clone().premultiply(new THREE.Matrix4().makeScale(scaleMm, scaleMm, scaleMm));

    for (let i = 0; i + 2 < position.count && triangles.length < maxFacets; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix);
      const b = new THREE.Vector3().fromBufferAttribute(position, i + 1).applyMatrix4(matrix);
      const c = new THREE.Vector3().fromBufferAttribute(position, i + 2).applyMatrix4(matrix);
      const area = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
      if (area > 1e-5) {
        triangles.push({ vertices: [a, b, c], color });
      }
    }

    geometry.dispose();
  });

  return triangles;
}

function triangleToFlat(vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3]): Vec2[] {
  const [a, b, c] = vertices;
  const ab = a.distanceTo(b);
  const ac = a.distanceTo(c);
  const bc = b.distanceTo(c);
  if (ab < 1e-8 || ac < 1e-8 || bc < 1e-8) return [];

  const cx = (ac * ac + ab * ab - bc * bc) / (2 * ab);
  const cy = Math.sqrt(Math.max(0, ac * ac - cx * cx));
  const points = [
    { x: 0, y: 0 },
    { x: ab, y: 0 },
    { x: cx, y: cy }
  ];
  return signedArea(points) < 0 ? [...points].reverse() : points;
}

function normalOf(vertices: [THREE.Vector3, THREE.Vector3, THREE.Vector3]): THREE.Vector3 {
  return new THREE.Vector3()
    .subVectors(vertices[1], vertices[0])
    .cross(new THREE.Vector3().subVectors(vertices[2], vertices[0]))
    .normalize();
}

function packPolygons(polygons: Vec2[][], sheetWidthMm: number, paddingMm: number): Vec2[][] {
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  return polygons.map((polygon) => {
    const bounds = boundsOf(polygon);
    if (cursorX > 0 && cursorX + bounds.width > sheetWidthMm) {
      cursorX = 0;
      cursorY += rowHeight + paddingMm;
      rowHeight = 0;
    }

    const dx = cursorX - bounds.min.x;
    const dy = cursorY - bounds.min.y;
    const packed = polygon.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    cursorX += bounds.width + paddingMm;
    rowHeight = Math.max(rowHeight, bounds.height);
    return packed;
  });
}

function pointKey(point: THREE.Vector3): string {
  return `${Math.round(point.x * 1000)},${Math.round(point.y * 1000)},${Math.round(point.z * 1000)}`;
}

function edgeKey(a: THREE.Vector3, b: THREE.Vector3): string {
  const ka = pointKey(a);
  const kb = pointKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

function uniqueEdges(triangles: Triangle[]): MeshEdge[] {
  const edges = new Map<string, { id: string; a: Vec3Tuple; b: Vec3Tuple; normal: THREE.Vector3; count: number }>();
  triangles.forEach((triangle, triangleIndex) => {
    const triangleNormal = normalOf(triangle.vertices);
    const pairs: [THREE.Vector3, THREE.Vector3][] = [
      [triangle.vertices[0], triangle.vertices[1]],
      [triangle.vertices[1], triangle.vertices[2]],
      [triangle.vertices[2], triangle.vertices[0]]
    ];
    pairs.forEach(([a, b], edgeIndex) => {
      const key = edgeKey(a, b);
      const existing = edges.get(key);
      if (existing) {
        existing.normal.add(triangleNormal);
        existing.count += 1;
      } else {
        edges.set(key, {
          id: `E${triangleIndex + 1}-${edgeIndex + 1}`,
          a: vecToTuple(a),
          b: vecToTuple(b),
          normal: triangleNormal.clone(),
          count: 1
        });
      }
    });
  });
  return [...edges.values()].map((edge) => ({
    id: edge.id,
    a: edge.a,
    b: edge.b,
    normal: vecToTuple(edge.normal.normalize())
  }));
}

function sourceBounds(triangles: Triangle[]): MeshFacetProject["sourceBoundsMm"] {
  const points = triangles.flatMap((triangle) => triangle.vertices);
  if (points.length === 0) return { width: 0, height: 0, depth: 0 };
  const box = new THREE.Box3().setFromPoints(points);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { width: size.x, height: size.y, depth: size.z };
}

export async function meshFileToFacetProject(filesOrFile: File[] | File, config: LampConfig): Promise<MeshFacetProject> {
  const files = Array.isArray(filesOrFile) ? filesOrFile : [filesOrFile];
  const primaryFile = choosePrimaryMeshFile(files);
  const root = await fileToObject3D(files);
  const scaleMm = clamp(config.meshUnitScaleMm, 0.001, 10000);
  const maxFacets = Math.round(clamp(config.meshMaxFacets, 1, 10000));
  const sheetWidthMm = clamp(config.templateSheetWidthMm, 100, 5000);
  const triangles = extractTriangles(root, scaleMm, maxFacets);

  if (triangles.length === 0) {
    throw new Error("No triangle facets were found in the imported mesh.");
  }

  const localOutlines = triangles.map((triangle) => triangleToFlat(triangle.vertices));
  const packedOutlines = packPolygons(localOutlines, sheetWidthMm, Math.max(8, glassInsetFromConfig(config) * 6));
  const glassInsetMm = glassInsetFromConfig(config);

  const facets: MeshFacet[] = triangles.map((triangle, index) => ({
    id: `M${index + 1}`,
    color: triangle.color || FACET_COLORS[index % FACET_COLORS.length],
    vertices: triangle.vertices.map(vecToTuple),
    normal: vecToTuple(normalOf(triangle.vertices)),
    centerlineOutline: packedOutlines[index],
    glassCutOutline: offsetPolygonInwardRobust(packedOutlines[index], glassInsetMm)
  }));

  const flatOutlines: FlatOutlineInput[] = facets.map((facet) => ({
    id: facet.id,
    color: facet.color,
    outline: facet.centerlineOutline
  }));

  const flatPattern = createFlatPatternDocument(
    `Faceted stained-glass mesh templates from ${primaryFile.name}`,
    "Every imported mesh triangle is converted into one flat glass facet. This supports arbitrary 3D shapes by approximating them as planar glass facets.",
    flatOutlines,
    glassInsetMm,
    {
      sourceFile: primaryFile.name,
      sourceType: "3D mesh facets",
      meshUnitScaleMm: fmt(scaleMm),
      maxFacets,
      exportedFacets: facets.length,
      templateSheetWidthMm: fmt(sheetWidthMm)
    }
  );

  return {
    title: primaryFile.name,
    facets,
    edges: uniqueEdges(triangles),
    flatPattern,
    sourceBoundsMm: sourceBounds(triangles)
  };
}
