// Public re-exports for the offline Flow Toolkit (Layer 1).

export type {
  AuthoringSpec,
  CommentSpec,
  ConnectionSpec,
  GroupSpec,
  NodeSpec,
  Position,
  TabSpec,
} from './authoring/types.js';
export {
  compile,
  AUTHORING_KEY_FIELD,
  type CompileOptions,
  type CompileResult,
} from './authoring/compile.js';
export { decompile } from './authoring/decompile.js';
export {
  comment,
  connect,
  debug,
  fnNode,
  genericNode,
  group,
  inject,
  tab,
} from './authoring/builders.js';
export { addDebugNode } from './authoring/operations/add-debug-node.js';
export {
  runValidators,
  type Diagnostic,
  type ValidationReport,
  type DiagnosticSeverity,
} from './validate/index.js';
export { lintFlows } from './lint/flows-lint.js';
export {
  renderSvg,
  renderGeometry,
  type RenderGeometryEntry,
  type RenderGeometryPort,
} from './render/svg.js';
export { diffFlows, summarizeDiff, type SemanticDiff } from './diff/semantic.js';
export { normalize } from './diff/normalize.js';
export { snapToGrid, isOnGrid, DEFAULT_GRID } from './layout/grid.js';
export { placeRightOf, DEFAULT_RIGHT_OFFSET } from './layout/placement.js';
export { defaultBounds, inBounds, type Bounds } from './layout/bounds.js';
export { FilesystemSnapshotStore } from './snapshot/filesystem.js';
export { type SnapshotStore } from './snapshot/store.js';
export { StagedStore, StagedChangeSchema, type StagedChange } from './staging/staged-store.js';
