import "./style.css";
import type { FlatPatternDocument, LampConfig, MeshFacetProject, Pattern } from "./types";
import { FrustumSurface } from "./geometry/frustumSurface";
import { clamp } from "./geometry/math";
import { measureLayout } from "./geometry/flatLayout";
import { measureFlatPatternDocument } from "./geometry/flatPattern";
import { createPattern } from "./patterns/samplePattern";
import { LampScene } from "./render/scene";
import { ControlPanel, DEFAULT_CONFIG } from "./ui/controls";
import { createFlatDocumentFromFrustum, exportFlatPatternSvg, exportPatternSvg } from "./export/svg";
import { exportFlatPatternDxf, exportPatternDxf } from "./export/dxf";
import { downloadTextFile } from "./export/download";
import { artworkFileToFlatPattern } from "./import/artworkImport";
import { meshFileToFacetProject } from "./import/meshImport";
import { installOfflineNetworkGuard } from "./offline/networkGuard";

const controlsRoot = document.querySelector<HTMLElement>("#controls");
const viewportRoot = document.querySelector<HTMLElement>("#viewport");

if (!controlsRoot || !viewportRoot) {
  throw new Error("Missing #controls or #viewport root element.");
}

const scene = new LampScene(viewportRoot);
let currentConfig: LampConfig = { ...DEFAULT_CONFIG };
let currentPattern: Pattern = createPattern(currentConfig);
let currentSurface = new FrustumSurface(currentConfig);
let currentFlatDocument: FlatPatternDocument = createFlatDocumentFromFrustum(currentConfig, currentPattern, currentSurface);
let currentMeshProject: MeshFacetProject | null = null;
let artworkFile: File | null = null;
let meshFiles: File[] = [];
let blockedNetworkCount = 0;
let lastBlockedNetworkUrl = "";
let rebuildToken = 0;

function sanitizeConfig(config: LampConfig): LampConfig {
  return {
    ...config,
    bottomRadiusMm: clamp(config.bottomRadiusMm, 20, 600),
    topRadiusMm: clamp(config.topRadiusMm, 20, 600),
    heightMm: clamp(config.heightMm, 40, 1000),
    radialSegments: Math.round(clamp(config.radialSegments, 3, 96)),
    bands: Math.round(clamp(config.bands, 1, 48)),
    waveAmplitudeDeg: clamp(config.waveAmplitudeDeg, 0, 12),
    waveCycles: clamp(config.waveCycles, 0, 6),
    cameHeartWidthMm: clamp(config.cameHeartWidthMm, 0, 8),
    fitToleranceMm: clamp(config.fitToleranceMm, 0, 3),
    visibleLeadFaceWidthMm: clamp(config.visibleLeadFaceWidthMm, 0.5, 16),
    glassThicknessMm: clamp(config.glassThicknessMm, 1, 8),
    moldOffsetMm: clamp(config.moldOffsetMm, 0, 8),
    artworkWidthMm: clamp(config.artworkWidthMm, 25, 5000),
    artworkHeightMm: clamp(config.artworkHeightMm, 25, 5000),
    artworkPanelCount: Math.round(clamp(config.artworkPanelCount, 8, 800)),
    artworkRelaxations: Math.round(clamp(config.artworkRelaxations, 0, 8)),
    artworkTraceDrawing: Boolean(config.artworkTraceDrawing),
    artworkColorCount: Math.round(clamp(config.artworkColorCount, 2, 32)),
    artworkLeadThreshold: Math.round(clamp(config.artworkLeadThreshold, 10, 180)),
    artworkMinPieceAreaPx: Math.round(clamp(config.artworkMinPieceAreaPx, 4, 5000)),
    artworkSimplifyPx: clamp(config.artworkSimplifyPx, 0, 8),
    meshUnitScaleMm: clamp(config.meshUnitScaleMm, 0.001, 10000),
    meshMaxFacets: Math.round(clamp(config.meshMaxFacets, 1, 10000)),
    templateSheetWidthMm: clamp(config.templateSheetWidthMm, 100, 5000)
  };
}

installOfflineNetworkGuard((url) => {
  blockedNetworkCount += 1;
  lastBlockedNetworkUrl = url;
  console.warn(`Offline mode blocked network request: ${url}`);
});

function offlineStatusSuffix(): string {
  return blockedNetworkCount > 0
    ? ` Offline guard blocked ${blockedNetworkCount} non-local request${blockedNetworkCount === 1 ? "" : "s"}; latest: ${lastBlockedNetworkUrl}`
    : " Offline mode: local files only; no cloud or AI calls.";
}

function rebuildFrustum(config: LampConfig): void {
  currentSurface = new FrustumSurface(config);
  currentPattern = createPattern(config);
  currentFlatDocument = createFlatDocumentFromFrustum(config, currentPattern, currentSurface);
  currentMeshProject = null;
  scene.update(config, currentPattern, currentSurface);
  controls.updateStats(measureLayout(config, currentPattern, currentSurface));
  controls.setStatus(`Frustum mode is procedural. Change dimensions or export SVG/DXF when ready.${offlineStatusSuffix()}`);
}

async function rebuildArtwork(config: LampConfig, token: number): Promise<void> {
  if (!artworkFile) {
    scene.updateFlatPattern(config, currentFlatDocument);
    controls.updateStats(measureFlatPatternDocument(config, currentFlatDocument, "2D artwork"));
    controls.setStatus(`Choose a PNG, JPG, WebP, or SVG file to convert artwork into glass templates.${offlineStatusSuffix()}`);
    return;
  }

  controls.setStatus(`Importing 2D artwork: ${artworkFile.name}`);
  const document = await artworkFileToFlatPattern(artworkFile, config);
  if (token !== rebuildToken) return;
  currentFlatDocument = document;
  refreshEditor();
  currentMeshProject = null;
  scene.updateFlatPattern(config, document);
  controls.updateStats(measureFlatPatternDocument(config, document, "2D artwork"));
  controls.setStatus(`Loaded ${artworkFile.name} as ${document.panels.length} glass piece${document.panels.length === 1 ? "" : "s"}.${offlineStatusSuffix()}`);
}

async function rebuildMesh(config: LampConfig, token: number): Promise<void> {
  if (meshFiles.length === 0) {
    controls.setStatus(`Choose an OBJ, STL, GLB, or GLTF file to facet a 3D shape into flat glass templates. For .gltf files with external .bin/textures, select all related local files together.${offlineStatusSuffix()}`);
    scene.updateFlatPattern(config, currentFlatDocument);
    controls.updateStats(measureFlatPatternDocument(config, currentFlatDocument, "3D mesh facets"));
    return;
  }

  const meshNames = meshFiles.map((file) => file.name).join(", ");
  controls.setStatus(`Importing 3D mesh from local file${meshFiles.length === 1 ? "" : "s"}: ${meshNames}`);
  const project = await meshFileToFacetProject(meshFiles, config);
  if (token !== rebuildToken) return;
  currentMeshProject = project;
  currentFlatDocument = project.flatPattern;
  scene.updateMeshProject(config, project);
  const stats = measureFlatPatternDocument(config, project.flatPattern, "3D mesh facets");
  stats.notes = [
    `Mesh bounds: ${project.sourceBoundsMm.width.toFixed(1)} × ${project.sourceBoundsMm.height.toFixed(1)} × ${project.sourceBoundsMm.depth.toFixed(1)} mm.`,
    "Each mesh triangle is treated as one rigid flat glass facet.",
    ...(stats.notes ?? [])
  ];
  controls.updateStats(stats);
  controls.setStatus(`Loaded ${project.title} as ${project.facets.length} triangular glass facet${project.facets.length === 1 ? "" : "s"}.${offlineStatusSuffix()}`);
}

function rebuild(rawConfig: LampConfig): void {
  const token = ++rebuildToken;
  currentConfig = sanitizeConfig(rawConfig);
  editor.hidden = currentConfig.mode !== 'artwork2d';

  if (currentConfig.mode === "frustum") {
    rebuildFrustum(currentConfig);
    return;
  }

  if (currentConfig.mode === "artwork2d") {
    void rebuildArtwork(currentConfig, token).catch((error) => {
      if (token !== rebuildToken) return;
      controls.setStatus(error instanceof Error ? error.message : "Artwork import failed.");
      scene.showMessage(error instanceof Error ? error.message : "Artwork import failed.");
    });
    return;
  }

  void rebuildMesh(currentConfig, token).catch((error) => {
    if (token !== rebuildToken) return;
    controls.setStatus(error instanceof Error ? error.message : "Mesh import failed.");
    scene.showMessage(error instanceof Error ? error.message : "Mesh import failed.");
  });
}

function filenameBase(): string {
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const mode = currentConfig.mode === "mesh3d" ? "mesh-facets" : currentConfig.mode === "artwork2d" ? "artwork" : "lampshade";
  return `stained-glass-${mode}-${now}`;
}

function ensureFlatDocument(): FlatPatternDocument {
  if (currentConfig.mode === "frustum") {
    return createFlatDocumentFromFrustum(currentConfig, currentPattern, currentSurface);
  }
  if (currentConfig.mode === "mesh3d" && currentMeshProject) {
    return currentMeshProject.flatPattern;
  }
  return currentFlatDocument;
}

const controls = new ControlPanel(controlsRoot, {
  onChange: rebuild,
  onArtworkFile: (file, config) => {
    artworkFile = file;
    meshFiles = [];
    rebuild(config);
  },
  onMeshFiles: (files, config) => {
    meshFiles = files;
    artworkFile = null;
    rebuild(config);
  },
  onExportSvg: () => {
    const svg = currentConfig.mode === "frustum"
      ? exportPatternSvg(currentConfig, currentPattern, currentSurface)
      : exportFlatPatternSvg(ensureFlatDocument());
    downloadTextFile(`${filenameBase()}.svg`, "image/svg+xml;charset=utf-8", svg);
    scene.showMessage("Exported SVG with seam centerlines, panel centerlines, labels, and glass cut outlines.");
  },
  onExportDxf: () => {
    const dxf = currentConfig.mode === "frustum"
      ? exportPatternDxf(currentConfig, currentPattern, currentSurface)
      : exportFlatPatternDxf(ensureFlatDocument());
    downloadTextFile(`${filenameBase()}.dxf`, "application/dxf;charset=utf-8", dxf);
    scene.showMessage("Exported DXF layers: GLASS_CUT, PANEL_CENTERLINE, SEAM_CENTERLINE, and LABELS.");
  }
});

const welcome = document.createElement('section');
welcome.innerHTML = `<a href="/">← Carla's workshop</a><h2>Make something unexpected.</h2><p>Start with a sample, recolor individual pieces, then export your pattern. Files are processed on this device.</p><button id="sample-artwork" type="button">Try the stained-glass sample</button><p>Changing source settings rebuilds the pattern and resets color edits.</p>`;
controlsRoot.prepend(welcome);
const editor = document.createElement('section');
editor.innerHTML = `<h3>Recolor a glass piece</h3><label for="piece">Piece</label><select id="piece"></select><label for="piece-color">Glass color</label><input id="piece-color" type="color"><button id="undo-color" type="button" disabled>Undo color change</button><p id="edit-status" role="status"></p>`;
welcome.after(editor);
const piece = editor.querySelector<HTMLSelectElement>('#piece')!;
const color = editor.querySelector<HTMLInputElement>('#piece-color')!;
const undo = editor.querySelector<HTMLButtonElement>('#undo-color')!;
let colorHistory: {index:number;color:string}[] = [];
function refreshEditor(): void {
  if (!editor) return;
  editor.hidden = currentConfig.mode !== 'artwork2d';
  piece.replaceChildren(...currentFlatDocument.panels.map((panel,index)=>new Option(panel.id,String(index))));
  colorHistory=[]; undo.disabled=true;
  color.value=currentFlatDocument.panels[0]?.color ?? '#74bbab';
}
piece.onchange=()=>{ color.value=currentFlatDocument.panels[Number(piece.value)].color; };
color.onchange=()=>{
  const index=Number(piece.value), panel=currentFlatDocument.panels[index];
  if (!panel) return;
  colorHistory.push({index,color:panel.color});panel.color=color.value;undo.disabled=false;
  scene.updateFlatPattern(currentConfig,currentFlatDocument);
  editor.querySelector('#edit-status')!.textContent=`${panel.id} recolored. SVG export includes this color.`;
};
undo.onclick=()=>{
  const previous=colorHistory.pop();if(!previous)return;
  currentFlatDocument.panels[previous.index].color=previous.color;
  piece.value=String(previous.index);color.value=previous.color;undo.disabled=!colorHistory.length;
  scene.updateFlatPattern(currentConfig,currentFlatDocument);
  editor.querySelector('#edit-status')!.textContent='Color change undone.';
};
welcome.querySelector<HTMLButtonElement>('#sample-artwork')!.onclick=()=>{
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><polygon fill="#ebb94b" points="0,0 200,0 200,100"/><polygon fill="#619b87" points="0,0 200,100 0,300"/><polygon fill="#3e7581" points="0,300 200,100 200,300"/><polygon fill="#b66d88" points="200,0 400,0 400,300 200,100"/><polygon fill="#df8551" points="200,100 400,300 200,300"/></svg>`;
  artworkFile=new File([svg],'workshop-sample.svg',{type:'image/svg+xml'});
  const mode=document.querySelector<HTMLSelectElement>('#mode')!;mode.value='artwork2d';mode.dispatchEvent(new Event('change',{bubbles:true}));
};
rebuild(DEFAULT_CONFIG);
refreshEditor();
