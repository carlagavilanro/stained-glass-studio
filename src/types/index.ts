export type Vec2 = {
  x: number;
  y: number;
};

export type Vec3Tuple = [number, number, number];

export type UV = {
  /** Circumferential angle in radians. */
  theta: number;
  /** Height coordinate in millimeters from the bottom rim. */
  z: number;
};

export type AppMode = "frustum" | "artwork2d" | "mesh3d";

export type Panel = {
  id: string;
  color: string;
  uv: UV[];
};

export type SeamKind = "vertical" | "horizontal" | "boundary" | "decorative";

export type Seam = {
  id: string;
  kind: SeamKind;
  uv: UV[];
  closed?: boolean;
};

export type LampConfig = {
  mode: AppMode;
  bottomRadiusMm: number;
  topRadiusMm: number;
  heightMm: number;
  radialSegments: number;
  bands: number;
  waveAmplitudeDeg: number;
  waveCycles: number;
  cameHeartWidthMm: number;
  fitToleranceMm: number;
  visibleLeadFaceWidthMm: number;
  glassThicknessMm: number;
  moldOffsetMm: number;
  /** Width for imported flat artwork/mosaic output. */
  artworkWidthMm: number;
  /** Height for imported flat artwork/mosaic output. */
  artworkHeightMm: number;
  /** Target number of Voronoi pieces for raster painting imports. */
  artworkPanelCount: number;
  /** Lloyd relaxation passes used to even out raster-derived pieces. */
  artworkRelaxations: number;
  /** Use CoopGlass-style line/color detection instead of inventing Voronoi cells. */
  artworkTraceDrawing: boolean;
  /** Number of color families used while tracing raster artwork. */
  artworkColorCount: number;
  /** Luma below this value is treated as lead/came/solder line artwork. */
  artworkLeadThreshold: number;
  /** Ignore traced specks smaller than this many source pixels. */
  artworkMinPieceAreaPx: number;
  /** Pixel simplification applied to traced piece outlines before scaling. */
  artworkSimplifyPx: number;
  /** Multiplier that converts imported mesh units to millimeters. */
  meshUnitScaleMm: number;
  /** Cap the number of triangles converted into glass facets. */
  meshMaxFacets: number;
  /** Width of the exported facet-template sheet before starting a new row. */
  templateSheetWidthMm: number;
  showMold: boolean;
  showGlass: boolean;
  showLead: boolean;
  showFlatReference: boolean;
};

export type Pattern = {
  panels: Panel[];
  seams: Seam[];
};

export type FlatSeam = {
  id: string;
  points: Vec2[];
  closed?: boolean;
};

export type FlatPanel = {
  id: string;
  color: string;
  centerlineOutline: Vec2[];
  /** The largest inward-offset outline, kept for compatibility with simple consumers. */
  glassCutOutline: Vec2[];
  /** All inward-offset contours returned by the robust offsetter. Usually one. */
  glassCutOutlines: Vec2[][];
};

export type FlatSolderRegion = {
  id: string;
  outline: Vec2[];
};

export type FlatPatternDocument = {
  title: string;
  description: string;
  units: "mm";
  panels: FlatPanel[];
  seams: FlatSeam[];
  /** Optional flowed solder/lead fill regions, mainly for traced raster artwork previews. */
  solderRegions?: FlatSolderRegion[];
  metadata: Record<string, string | number | boolean>;
};

export type MeshFacet = {
  id: string;
  color: string;
  vertices: Vec3Tuple[];
  normal: Vec3Tuple;
  centerlineOutline: Vec2[];
  glassCutOutline: Vec2[];
};

export type MeshEdge = {
  id: string;
  a: Vec3Tuple;
  b: Vec3Tuple;
  normal: Vec3Tuple;
};

export type MeshFacetProject = {
  title: string;
  facets: MeshFacet[];
  edges: MeshEdge[];
  flatPattern: FlatPatternDocument;
  sourceBoundsMm: {
    width: number;
    height: number;
    depth: number;
  };
};

export type LayoutStats = {
  modeLabel: string;
  panelCount: number;
  seamCount: number;
  glassInsetMm: number;
  unrolledWidthMm: number;
  slantHeightMm: number;
  maxPanelSagittaMm: number;
  notes?: string[];
};
