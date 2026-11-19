/**
 * cmtool-core: la lógica para migrar contenido de Contentful entre ambientes, sin pantalla.
 * Lo usan el CLI (cmtool-cli) y lo puede usar una web o un backend. No depende de Node ni de una
 * terminal: lo que necesita disco (respaldos en archivos) está en cmtool-core/node.
 *
 * Esta es la API pública, explícita: lo que no está aquí es interno y puede cambiar sin aviso.
 * Se usa así:
 *  1. `connect` abre la conexión y `connection.space(id)` el space (sus lecturas quedan guardadas).
 *  2. Una migración por etapas (entryMigration, modelMigration, assetMigration, backupRestore):
 *     analizar (solo lee) → decidir → plan (puro) → execute (escribe, con su writer atado a destino).
 *  3. Lo demás sirve para mostrar y decidir: comparaciones, reportes, textos y utilidades.
 */

// Lo que muestran y deciden las etapas
export type { Analysis, TreeAnalysis } from './analyze.ts';
// 3. Respaldo y avance de la escritura (dónde se guarda y cómo se muestra lo decide quien lo usa)
export {
  type Backup,
  type BackupData,
  type CreatedKind,
  createBackup,
  isBackup,
  type SaveBackup,
  type SavedEntry,
} from './backup.ts';
// 7. Utilidades: flags, IDs, ambientes, consultas y límites
export { LIMITS } from './config.ts';
// 1. Conectarse
export { type Connection, type ConnectOptions, connect, openSpace, type SpaceConnection } from './connection.ts';
export {
  CMA_HOST_NAMES,
  CMA_HOSTS,
  type Credentials,
  createCma,
  type RequestListener,
} from './contentful/client.ts';
// 5. Lecturas sueltas: buscar y elegir qué migrar
export {
  currentUser,
  fetchAssets,
  fetchEntries,
  listEntries,
  readTags,
  searchAssets,
  searchEntries,
} from './contentful/read.ts';
// Tipos de Contentful, con nombres cortos
export type {
  Account,
  Asset,
  Cma,
  ContentType,
  EditorControl,
  EditorInterface,
  Entry,
  EntryTree,
  Environment,
  Envs,
  Field,
  Locales,
  Space,
  Tag,
  TagLink,
} from './contentful/types.ts';
export { type AssetInfo, describeAsset } from './core/assets.ts';
export { type Decision, formatDecision, parseDecision } from './core/decision.ts';
// 4. Comparar (solo lectura)
export {
  EDITOR_PART,
  type EditorFieldDiff,
  type EditorPart,
  type SettingChange,
} from './core/editor.ts';
export { assetIdsOf, contentTypeOf, makeTitleOf } from './core/entries.ts';
export {
  compareEntryFields,
  type FieldComparison,
  isFieldChange,
  migrationFields,
  summarizeValue,
  TAGS,
  VALUE,
  type ValueStatus,
} from './core/entry-compare.ts';
export { looksLikeProduction, resolveEnvironment, sortEnvironments } from './core/environments.ts';
export { type ParsedIds, parseEntryIds, parseIds } from './core/ids.ts';
export {
  type ContentTypeDiff,
  CT_INFO,
  type CtInfoChange,
  type CtInfoPart,
  compareModels,
  FIELD,
  type FieldRow,
  type FieldStatus,
  fieldType,
  hasDifferences,
  type ModelComparison,
  type RuleChanges,
} from './core/model.ts';
export {
  allPicks,
  CHANGE,
  changesStructure,
  countEditorFields,
  countNewFields,
  countRuleFields,
  type EditorDiffs,
  hasModelChanges,
  type ModelChanges,
  type ModelOption,
  type ModelPick,
} from './core/model-changes.ts';
export { type ModelChoices, modelChoices } from './core/model-choices.ts';
export {
  ACTION,
  type Action,
  isWrite,
  type Plan,
  type PlannedEntry,
  type UpdateCandidate,
  willExistInDst,
} from './core/plan.ts';
export type { RequiredGap } from './core/publish-check.ts';
export { type EntryQuery, entryQueryParams, isEmptyQuery, parseSince } from './core/query.ts';
export { backupOwner, OWNER, type Owner, RESTORE, type RestoreStatus, restoreStatus } from './core/restore.ts';
export { type EnvironmentStatus, environmentStatus } from './core/status.ts';
export {
  diffFieldValues,
  diffText,
  type LocaleTextDiff,
  TEXT,
  type TextPart,
  type TextPartKind,
  valueText,
} from './core/text-diff.ts';
// 8. Errores
export { AbortError, formatError, statusOf } from './errors.ts';
// 2. Migrar, por etapas. Solo `execute` escribe.
export { type AssetMigration, type AssetReview, assetMigration } from './migrations/assets.ts';
export {
  type EntryMigration,
  entryMigration,
  type MigrationPlan,
  type MigrationReview,
  type MigrationTree,
} from './migrations/entries.ts';
export { type ModelMigration, type ModelPlan, type ModelReview, modelMigration } from './migrations/model.ts';
export { type BackupRestore, backupRestore, type RestoreItem, type RestoreReview } from './migrations/restore.ts';
export type { Progress, WriteTools } from './migrations/shared.ts';
// 6. Reportes (Markdown) y textos sin formato para cualquier pantalla
export { entryComparisonReport, modelComparisonReport, statusReport } from './report/markdown.ts';
export { createRecordingRunner, type PhaseResult, type Runner } from './runner.ts';
export {
  assetDetailText,
  BACKUP_KIND_LABEL,
  changedFieldsText,
  contentTypeStatusParts,
  ctInfoText,
  editorDiffText,
  fieldStatusText,
  formatBytes,
  modelPicksSummary,
  modelPickText,
  ruleUpdateText,
} from './text.ts';
