import type { FlatPatternDocument, LampConfig } from "../types";
import { rasterPaintingToFlatPattern } from "./paintingMosaic";
import { svgArtworkToFlatPattern } from "./svgArtwork";

export async function artworkFileToFlatPattern(file: File, config: LampConfig): Promise<FlatPatternDocument> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "svg" || file.type === "image/svg+xml") {
    return svgArtworkToFlatPattern(file, config);
  }
  return rasterPaintingToFlatPattern(file, config);
}
