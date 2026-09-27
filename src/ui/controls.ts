import type { AppMode, LampConfig, LayoutStats } from "../types";
import { fmt } from "../geometry/math";

export const DEFAULT_CONFIG: LampConfig = {
  mode: "frustum",
  bottomRadiusMm: 145,
  topRadiusMm: 85,
  heightMm: 260,
  radialSegments: 12,
  bands: 5,
  waveAmplitudeDeg: 2.4,
  waveCycles: 1,
  cameHeartWidthMm: 1.6,
  fitToleranceMm: 0.25,
  visibleLeadFaceWidthMm: 5.0,
  glassThicknessMm: 3.0,
  moldOffsetMm: 1.0,
  artworkWidthMm: 400,
  artworkHeightMm: 300,
  artworkPanelCount: 120,
  artworkRelaxations: 2,
  artworkTraceDrawing: true,
  artworkColorCount: 12,
  artworkLeadThreshold: 118,
  artworkMinPieceAreaPx: 90,
  artworkSimplifyPx: 1.4,
  meshUnitScaleMm: 1,
  meshMaxFacets: 600,
  templateSheetWidthMm: 900,
  showMold: true,
  showGlass: true,
  showLead: true,
  showFlatReference: false
};

type ControlCallbacks = {
  onChange: (config: LampConfig) => void;
  onArtworkFile: (file: File, config: LampConfig) => void;
  onMeshFiles: (files: File[], config: LampConfig) => void;
  onExportSvg: () => void;
  onExportDxf: () => void;
};

function numberInput(id: keyof LampConfig, label: string, value: number, min: number, max: number, step: number): string {
  return `<label for="${id}"><span>${label}</span><input id="${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" /></label>`;
}

function checkboxInput(id: keyof LampConfig, label: string, checked: boolean): string {
  return `<label for="${id}"><span>${label}</span><input id="${id}" type="checkbox" ${checked ? "checked" : ""} /></label>`;
}

function modeSelect(value: AppMode): string {
  return `<label for="mode"><span>Source mode</span><select id="mode">
    <option value="frustum" ${value === "frustum" ? "selected" : ""}>Parametric frustum / cylinder</option>
    <option value="artwork2d" ${value === "artwork2d" ? "selected" : ""}>2D painting or SVG artwork</option>
    <option value="mesh3d" ${value === "mesh3d" ? "selected" : ""}>Arbitrary 3D mesh facets</option>
  </select></label>`;
}

export class ControlPanel {
  private readonly root: HTMLElement;
  private readonly callbacks: ControlCallbacks;
  private statsElement!: HTMLElement;
  private statusElement!: HTMLElement;

  constructor(root: HTMLElement, callbacks: ControlCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.render();
    this.bind();
  }

  getConfig(): LampConfig {
    return {
      mode: this.modeValue(),
      bottomRadiusMm: this.numberValue("bottomRadiusMm"),
      topRadiusMm: this.numberValue("topRadiusMm"),
      heightMm: this.numberValue("heightMm"),
      radialSegments: Math.round(this.numberValue("radialSegments")),
      bands: Math.round(this.numberValue("bands")),
      waveAmplitudeDeg: this.numberValue("waveAmplitudeDeg"),
      waveCycles: this.numberValue("waveCycles"),
      cameHeartWidthMm: this.numberValue("cameHeartWidthMm"),
      fitToleranceMm: this.numberValue("fitToleranceMm"),
      visibleLeadFaceWidthMm: this.numberValue("visibleLeadFaceWidthMm"),
      glassThicknessMm: this.numberValue("glassThicknessMm"),
      moldOffsetMm: this.numberValue("moldOffsetMm"),
      artworkWidthMm: this.numberValue("artworkWidthMm"),
      artworkHeightMm: this.numberValue("artworkHeightMm"),
      artworkPanelCount: Math.round(this.numberValue("artworkPanelCount")),
      artworkRelaxations: Math.round(this.numberValue("artworkRelaxations")),
      artworkTraceDrawing: this.booleanValue("artworkTraceDrawing"),
      artworkColorCount: Math.round(this.numberValue("artworkColorCount")),
      artworkLeadThreshold: Math.round(this.numberValue("artworkLeadThreshold")),
      artworkMinPieceAreaPx: Math.round(this.numberValue("artworkMinPieceAreaPx")),
      artworkSimplifyPx: this.numberValue("artworkSimplifyPx"),
      meshUnitScaleMm: this.numberValue("meshUnitScaleMm"),
      meshMaxFacets: Math.round(this.numberValue("meshMaxFacets")),
      templateSheetWidthMm: this.numberValue("templateSheetWidthMm"),
      showMold: this.booleanValue("showMold"),
      showGlass: this.booleanValue("showGlass"),
      showLead: this.booleanValue("showLead"),
      showFlatReference: this.booleanValue("showFlatReference")
    };
  }

  updateStats(stats: LayoutStats): void {
    const notes = stats.notes?.length
      ? `<div class="notes">${stats.notes.map((note) => `<p>${note}</p>`).join("")}</div>`
      : "";
    this.statsElement.innerHTML = `
      <div class="metric"><span>Mode</span><strong>${stats.modeLabel}</strong></div>
      <div class="metric"><span>Glass pieces</span><strong>${stats.panelCount}</strong></div>
      <div class="metric"><span>Generated seams</span><strong>${stats.seamCount}</strong></div>
      <div class="metric"><span>Glass inset per piece</span><strong>${fmt(stats.glassInsetMm)} mm</strong></div>
      <div class="metric"><span>Flat layout width</span><strong>${fmt(stats.unrolledWidthMm)} mm</strong></div>
      <div class="metric"><span>Flat layout height/slant</span><strong>${fmt(stats.slantHeightMm)} mm</strong></div>
      <div class="metric"><span>Max panel sagitta</span><strong>${fmt(stats.maxPanelSagittaMm)} mm</strong></div>
      ${notes}
    `;
  }

  setStatus(message: string): void {
    this.statusElement.textContent = message;
  }

  private render(): void {
    this.root.innerHTML = `
      <h1>Stained Glass Studio</h1>
      <p>Generate exact frustum patterns, convert 2D art into mosaic glass pieces, or facet arbitrary 3D meshes into flat templates.</p>

      <fieldset>
        <legend>Input source</legend>
        ${modeSelect(DEFAULT_CONFIG.mode)}
        <label for="artwork-file"><span>2D artwork file</span><input id="artwork-file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" /></label>
        <label for="mesh-file"><span>3D mesh files</span><input id="mesh-file" type="file" multiple accept=".obj,.stl,.glb,.gltf,.bin,.png,.jpg,.jpeg,.webp,model/obj,model/stl,model/gltf-binary" /></label>
        <p id="import-status" class="note">Frustum mode is procedural. Choose 2D or 3D mode, then import local files to generate templates.</p>
      </fieldset>

      <fieldset>
        <legend>Offline / privacy</legend>
        <div class="offline-card"><strong>Offline-only runtime</strong><span>No AI APIs, no cloud processing, no analytics, and no CDN assets. Imported images, SVGs, and meshes are read by the browser from your own device. A network guard blocks non-local requests.</span></div>
      </fieldset>

      <fieldset>
        <legend>Lampshade mold</legend>
        ${numberInput("bottomRadiusMm", "Bottom radius, mm", DEFAULT_CONFIG.bottomRadiusMm, 20, 600, 1)}
        ${numberInput("topRadiusMm", "Top radius, mm", DEFAULT_CONFIG.topRadiusMm, 20, 600, 1)}
        ${numberInput("heightMm", "Height, mm", DEFAULT_CONFIG.heightMm, 40, 1000, 1)}
      </fieldset>

      <fieldset>
        <legend>Frustum pattern</legend>
        ${numberInput("radialSegments", "Radial pieces", DEFAULT_CONFIG.radialSegments, 3, 96, 1)}
        ${numberInput("bands", "Horizontal bands", DEFAULT_CONFIG.bands, 1, 48, 1)}
        ${numberInput("waveAmplitudeDeg", "Vertical seam wave, deg", DEFAULT_CONFIG.waveAmplitudeDeg, 0, 12, 0.1)}
        ${numberInput("waveCycles", "Wave cycles", DEFAULT_CONFIG.waveCycles, 0, 6, 0.25)}
      </fieldset>

      <fieldset>
        <legend>2D artwork conversion</legend>
        ${numberInput("artworkWidthMm", "Output width, mm", DEFAULT_CONFIG.artworkWidthMm, 25, 5000, 1)}
        ${numberInput("artworkHeightMm", "Output height, mm", DEFAULT_CONFIG.artworkHeightMm, 25, 5000, 1)}
        ${checkboxInput("artworkTraceDrawing", "Trace drawing lines/colors", DEFAULT_CONFIG.artworkTraceDrawing)}
        ${numberInput("artworkColorCount", "Detected color families", DEFAULT_CONFIG.artworkColorCount, 2, 32, 1)}
        ${numberInput("artworkLeadThreshold", "Lead/solder darkness", DEFAULT_CONFIG.artworkLeadThreshold, 10, 180, 1)}
        ${numberInput("artworkMinPieceAreaPx", "Ignore specks under px", DEFAULT_CONFIG.artworkMinPieceAreaPx, 4, 5000, 1)}
        ${numberInput("artworkSimplifyPx", "Trace smoothing, px", DEFAULT_CONFIG.artworkSimplifyPx, 0, 8, 0.1)}
        ${numberInput("artworkPanelCount", "Fallback mosaic pieces", DEFAULT_CONFIG.artworkPanelCount, 8, 800, 1)}
        ${numberInput("artworkRelaxations", "Fallback mosaic smoothing", DEFAULT_CONFIG.artworkRelaxations, 0, 8, 1)}
        <p class="note">Raster images use glass-first tracing: color regions become glass pieces, dark separator areas are filled as flowed solder, and cuts stay inset so pieces fit after solder/came allowance. If no drawn regions are detected, the Voronoi mosaic fallback is used.</p>
      </fieldset>

      <fieldset>
        <legend>3D mesh faceting</legend>
        ${numberInput("meshUnitScaleMm", "Mesh unit scale, mm", DEFAULT_CONFIG.meshUnitScaleMm, 0.001, 10000, 0.1)}
        ${numberInput("meshMaxFacets", "Max triangle facets", DEFAULT_CONFIG.meshMaxFacets, 1, 10000, 1)}
        ${numberInput("templateSheetWidthMm", "Template sheet width, mm", DEFAULT_CONFIG.templateSheetWidthMm, 100, 5000, 1)}
        <p class="note">Any compound 3D shape is converted into flat triangular glass facets. Smooth bending is not assumed. For .gltf files with external .bin or texture files, select the .gltf and all referenced local files together.</p>
      </fieldset>

      <fieldset>
        <legend>Lead came / glass allowance</legend>
        ${numberInput("cameHeartWidthMm", "Came heart, mm", DEFAULT_CONFIG.cameHeartWidthMm, 0, 8, 0.05)}
        ${numberInput("fitToleranceMm", "Fit tolerance, mm", DEFAULT_CONFIG.fitToleranceMm, 0, 3, 0.05)}
        ${numberInput("visibleLeadFaceWidthMm", "Visible lead face, mm", DEFAULT_CONFIG.visibleLeadFaceWidthMm, 0.5, 16, 0.1)}
        ${numberInput("glassThicknessMm", "Glass thickness, mm", DEFAULT_CONFIG.glassThicknessMm, 1, 8, 0.1)}
        ${numberInput("moldOffsetMm", "Preview offset, mm", DEFAULT_CONFIG.moldOffsetMm, 0, 8, 0.1)}
        <p class="note">Cut outlines are inset by (came heart + fit tolerance) / 2 per glass piece. Robust offsets use Clipper integer geometry.</p>
      </fieldset>

      <fieldset>
        <legend>Preview layers</legend>
        ${checkboxInput("showMold", "Show mold / mesh guide", DEFAULT_CONFIG.showMold)}
        ${checkboxInput("showGlass", "Show glass", DEFAULT_CONFIG.showGlass)}
        ${checkboxInput("showLead", "Show lead/solder", DEFAULT_CONFIG.showLead)}
        ${checkboxInput("showFlatReference", "Show flat reference", DEFAULT_CONFIG.showFlatReference)}
      </fieldset>

      <fieldset>
        <legend>Layout metrics</legend>
        <div id="stats"></div>
      </fieldset>

      <div class="button-row">
        <button id="export-svg" type="button">Export SVG</button>
        <button id="export-dxf" type="button">Export DXF</button>
      </div>
    `;
    this.statsElement = this.root.querySelector<HTMLElement>("#stats")!;
    this.statusElement = this.root.querySelector<HTMLElement>("#import-status")!;
  }

  private bind(): void {
    const inputs = this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=file]), select");
    for (const input of inputs) {
      input.addEventListener("input", () => this.callbacks.onChange(this.getConfig()));
      input.addEventListener("change", () => this.callbacks.onChange(this.getConfig()));
    }

    this.root.querySelector<HTMLInputElement>("#artwork-file")!.addEventListener("change", (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      const mode = this.root.querySelector<HTMLSelectElement>("#mode");
      if (mode) mode.value = "artwork2d";
      if (file) this.callbacks.onArtworkFile(file, { ...this.getConfig(), mode: "artwork2d" });
    });

    this.root.querySelector<HTMLInputElement>("#mesh-file")!.addEventListener("change", (event) => {
      const files = Array.from((event.target as HTMLInputElement).files ?? []);
      const mode = this.root.querySelector<HTMLSelectElement>("#mode");
      if (mode) mode.value = "mesh3d";
      if (files.length > 0) this.callbacks.onMeshFiles(files, { ...this.getConfig(), mode: "mesh3d" });
    });

    this.root.querySelector<HTMLButtonElement>("#export-svg")!.addEventListener("click", () => this.callbacks.onExportSvg());
    this.root.querySelector<HTMLButtonElement>("#export-dxf")!.addEventListener("click", () => this.callbacks.onExportDxf());
  }

  private modeValue(): AppMode {
    const select = this.root.querySelector<HTMLSelectElement>("#mode");
    const value = select?.value;
    return value === "artwork2d" || value === "mesh3d" ? value : "frustum";
  }

  private numberValue(id: keyof LampConfig): number {
    const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
    return input ? Number(input.value) : Number(DEFAULT_CONFIG[id]);
  }

  private booleanValue(id: keyof LampConfig): boolean {
    const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
    return input ? input.checked : Boolean(DEFAULT_CONFIG[id]);
  }
}
