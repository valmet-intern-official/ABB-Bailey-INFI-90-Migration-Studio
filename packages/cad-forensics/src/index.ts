export * from "./types";
export { buildScene, formatPlotTime, symbolCaptions, type ArchiveTime, type BuildSceneOptions, type SceneBuild } from "./scene";
export { resolveTerminals, outputLabels, type BlockTerminals } from "./terminals";
export { buildDocument, type CoverageRow, type EngineeringDocument } from "./render/document";
export { verifyDocument, type Defect } from "./verify";
export { goldenDigest, type GoldenDigest } from "./golden";
export { annotateSheet, indexSheets, ANNOTATION_LAYERS, type AnnotationRecord } from "./render/annotate";
export { sheetOverlays, OVERLAY_LAYERS } from "./render/overlay";
