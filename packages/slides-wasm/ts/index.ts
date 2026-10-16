// slides-core in the browser: a typed engine over the WebAssembly build.

export { applyChanges } from "./changes.ts";
export { DeckEngine, builtInLayouts, builtInThemes, expandComposite, expansionCount, loadSlides, operationSpecs, pageSizes, readingOrder, supportedFormatVersion, warmUp } from "./engine.ts";
export type { Applied, Listener, NewDeckOptions, OpSpec } from "./engine.ts";
export { SlidesError } from "./errors.ts";
export { picturePaths } from "./export.ts";
export type { ExportOptions, ExportWarning, PptxExport } from "./export.ts";
export { importPptx, planImport, renamePictures, similarRuns } from "./import.ts";
export type { ImportMode, ImportOptions, ImportPlan, ImportReport, ImportWarning, ImportedPicture, ImportedPptx, KeptObject, PlannedOperation } from "./import.ts";
export type { LintOptions } from "./lint.ts";
export { draftStoryboard, pageBlocks, pageBody, pageFingerprint, pageLink, pageMadeOf, pageSection, pageSections } from "./pages.ts";
export type { StoryPage } from "./pages.ts";
export { citationOrder, closestReference, referenceList, referencesVersion, setReferences, subscribeReferences } from "./references.ts";
export type * from "./generated/index.ts";
