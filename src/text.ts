/**
 * Textos (sin color) que comparten la terminal y los reportes en Markdown.
 */
import type { BackupData } from './backup.ts';
import type { AssetInfo } from './core/assets.ts';
import { EDITOR_PART, type EditorFieldDiff, type EditorPart } from './core/editor.ts';
import type { FieldComparison } from './core/entry-compare.ts';
import { type ContentTypeDiff, CT_INFO, type CtInfoPart, FIELD, type FieldRow, fieldType } from './core/model.ts';
import { CHANGE, type ModelPick } from './core/model-changes.ts';

export const BACKUP_KIND_LABEL: Record<BackupData['kind'], string> = {
  migrate: 'migración',
  model: 'modelo',
  assets: 'imágenes',
  restore: 'restore',
};

/** Nombres legibles de las validaciones de Contentful. */
const VALIDATION_LABEL: Record<string, string> = {
  linkContentType: 'tipos de entry permitidos',
  linkMimetypeGroup: 'tipo de archivo',
  size: 'tamaño',
  range: 'rango',
  in: 'valores permitidos',
  regexp: 'formato',
  prohibitRegexp: 'formato prohibido',
  unique: 'único',
  dateRange: 'rango de fechas',
  assetFileSize: 'peso del archivo',
  assetImageDimensions: 'dimensiones de imagen',
  enabledNodeTypes: 'bloques de rich text',
  enabledMarks: 'formatos de rich text',
  nodes: 'links en rich text',
};

const validationLabel = (name: string) => {
  const base = name.replace(/^items\./, '');
  return VALIDATION_LABEL[base] ?? base;
};

const validationsText = (names: string[]) => `validaciones: ${[...new Set(names.map(validationLabel))].join(', ')}`;

/** Cómo están las reglas de un campo en destino comparadas con origen. */
function rulesText({ rules, dstField }: FieldRow, dst: string, dstDefault: string | undefined): string {
  if (!rules) return 'reglas distintas';
  return [
    rules.renamed && dstField && `en ${dst} se llama «${dstField.name}»`,
    rules.requiredOnlyInDst && `obligatorio en ${dst}`,
    rules.requiredOnlyInSrc && `opcional en ${dst}`,
    rules.localizationLost && `no localizado en ${dst}: solo se copia ${dstDefault ?? 'el locale por defecto'}`,
    rules.localizedOnlyInDst && `localizado solo en ${dst}`,
    rules.validations.length && validationsText(rules.validations),
    rules.editingDiffers && dstField && (dstField.disabled ? `no se puede editar en ${dst}` : `editable en ${dst}`),
    rules.apiDiffers && dstField && (dstField.omitted ? `oculto en la API en ${dst}` : `sale en la API en ${dst}`),
    rules.defaultValueDiffers && 'valor por defecto distinto',
  ]
    .filter(Boolean)
    .join(' · ');
}

const yesNo = (value: boolean | undefined) => (value ? 'sí' : 'no');

/** "820 B", "34 KB", "1.2 MB"; vacío si no se sabe. */
export const formatBytes = (n: number | undefined): string =>
  n == null
    ? ''
    : n < 1024
      ? `${n} B`
      : n < 1024 ** 2
        ? `${Math.round(n / 1024)} KB`
        : `${(n / 1024 ** 2).toFixed(1)} MB`;

/** "image/png · 800×600 · 120 KB": el detalle de un archivo, con lo que se sepa. */
export const assetDetailText = ({ contentType, dimensions, bytes }: AssetInfo): string =>
  [contentType, dimensions && `${dimensions.width}×${dimensions.height}`, formatBytes(bytes)]
    .filter(Boolean)
    .join(' · ');

/** "2 campo(s): Título, CTA (campo nuevo)": lo que cambiaría al actualizar una entry. */
export const changedFieldsText = (fields: FieldComparison[], max = 50): string =>
  `${fields.length} campo(s): ${clipText(fields.map((f) => (f.newField ? `${f.name} (campo nuevo)` : f.name)).join(', '), max)}`;

/**
 * Qué cambia en destino al llevar las reglas de origen ("obligatorio: no → sí"…), con un
 * aviso cuando puede afectar el contenido que ya existe.
 */
export function ruleUpdateText({ rules, field, dstField }: FieldRow): string {
  if (!rules || !dstField) return 'reglas de origen';
  return [
    rules.renamed && `nombre: «${dstField.name}» → «${field.name}»`,
    (rules.requiredOnlyInDst || rules.requiredOnlyInSrc) &&
      `obligatorio: ${yesNo(dstField.required)} → ${yesNo(field.required)}`,
    (rules.localizationLost || rules.localizedOnlyInDst) &&
      `localizado: ${yesNo(dstField.localized)} → ${yesNo(field.localized)}`,
    rules.validations.length && validationsText(rules.validations),
    rules.editingDiffers && `editable: ${yesNo(!dstField.disabled)} → ${yesNo(!field.disabled)}`,
    rules.apiDiffers && `sale en la API: ${yesNo(!dstField.omitted)} → ${yesNo(!field.omitted)}`,
    rules.defaultValueDiffers && 'valor por defecto',
    rules.requiredOnlyInSrc && '⚠ las entries con este campo vacío no se podrán publicar',
    rules.localizedOnlyInDst && '⚠ se pierden los valores de los otros idiomas',
    rules.apiDiffers && field.omitted && '⚠ el campo deja de salir en la API: el sitio no lo recibe',
  ]
    .filter(Boolean)
    .join(' · ');
}

const clipText = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const quoted = (text: string | undefined) => (text ? `«${clipText(text, 40)}»` : 'vacío');

/** Nombres de los widgets de Contentful, como se ven en la pantalla de apariencia. */
const WIDGET_LABEL: Record<string, string> = {
  singleLine: 'Single line',
  multipleLine: 'Multiple line',
  markdown: 'Markdown',
  richTextEditor: 'Rich text',
  dropdown: 'Dropdown',
  radio: 'Radio',
  checkbox: 'Checkbox',
  tagEditor: 'Tags',
  listInput: 'List',
  slugEditor: 'Slug',
  urlEditor: 'URL',
  numberEditor: 'Number',
  rating: 'Rating',
  datePicker: 'Date picker',
  locationEditor: 'Location',
  boolean: 'Boolean',
  objectEditor: 'JSON editor',
  entryLinkEditor: 'Entry link',
  entryCardEditor: 'Entry card',
  entryLinksEditor: 'Entry links',
  entryCardsEditor: 'Entry cards',
  assetLinkEditor: 'Asset link',
  assetLinksEditor: 'Asset links',
  assetGalleryEditor: 'Asset gallery',
};

/** Nombres de los ajustes más comunes, como se ven en la pantalla de apariencia. */
const SETTING_LABEL: Record<string, string> = {
  showCreateEntityAction: 'Show "Create new entries"',
  showLinkEntityAction: 'Show "Link existing entries"',
  bulkEditing: 'Use bulk editing',
  trueLabel: 'texto de verdadero',
  falseLabel: 'texto de falso',
  stars: 'estrellas',
  format: 'formato de fecha',
  ampm: 'formato de hora',
};

const widgetName = (id: string | undefined) => (id ? `«${WIDGET_LABEL[id] ?? id}»` : '?');
const settingValue = (value: unknown) =>
  typeof value === 'boolean' ? yesNo(value) : value === undefined ? 'sin valor' : clipText(String(value), 20);

/** Cómo se describe cada parte de la apariencia que difiere. */
const EDITOR_PART_TEXT: Record<EditorPart, (diff: EditorFieldDiff, dst: string) => string> = {
  [EDITOR_PART.HELP_TEXT]: ({ helpText }, dst) =>
    helpText.dst === undefined
      ? `help text falta en ${dst}`
      : helpText.src === undefined
        ? `help text solo en ${dst}`
        : `help text distinto (en ${dst}: ${quoted(helpText.dst)})`,
  [EDITOR_PART.WIDGET]: ({ widget }, dst) => `widget ${widgetName(widget.src)} (en ${dst}: ${widgetName(widget.dst)})`,
  [EDITOR_PART.SETTINGS]: ({ settings }, dst) =>
    settings
      .map(
        ({ key, src, dst: current }) =>
          `${SETTING_LABEL[key] ?? key}: ${settingValue(src)} (en ${dst}: ${settingValue(current)})`,
      )
      .join(' · '),
};

/** Qué difiere en la apariencia de un campo: "help text falta en master", "widget dropdown (en master: singleLine)"… */
export const editorDiffText = (diff: EditorFieldDiff, dst: string): string =>
  diff.parts.map((part) => EDITOR_PART_TEXT[part](diff, dst)).join(' · ');

/**
 * Estado de un campo comparado con destino. `editor`: lo que difiere en su apariencia del
 * editor (no es parte del modelo, pero tampoco está al día).
 */
export function fieldStatusText(
  row: FieldRow,
  dst: string,
  dstDefault: string | undefined,
  editor?: EditorFieldDiff,
): string {
  const editorText = editor ? editorDiffText(editor, dst) : '';
  switch (row.status) {
    case FIELD.OK:
      return editorText || 'al día';
    case FIELD.RULES:
      return [rulesText(row, dst, dstDefault), editorText].filter(Boolean).join(' · ');
    case FIELD.MISSING:
      return `falta en ${dst}`;
    case FIELD.MISMATCH:
      return `en ${dst} es ${row.dstField ? fieldType(row.dstField) : '?'} → no se migra`;
    case FIELD.EXTRA:
      return `sobra en ${dst} → se conserva`;
  }
}

const CT_INFO_LABEL: Record<CtInfoPart, string> = {
  [CT_INFO.NAME]: 'nombre',
  [CT_INFO.DESCRIPTION]: 'descripción',
  [CT_INFO.DISPLAY_FIELD]: 'campo de título',
};

/** "nombre «Banner» (en master: «Banner viejo») · campo de título: Slug (en master: Título)". */
export function ctInfoText({ info, rows }: ContentTypeDiff, dst: string): string {
  const fieldName = (id: string | undefined) =>
    id ? (rows.find((r) => r.field.id === id)?.field.name ?? id) : undefined;
  return info
    .map(({ part, src, dst: current }) => {
      const show = part === CT_INFO.DISPLAY_FIELD ? fieldName : (v: string | undefined) => v;
      return `${CT_INFO_LABEL[part]} ${quoted(show(src))} (en ${dst}: ${quoted(show(current))})`;
    })
    .join(' · ');
}

/**
 * Resumen de un content type comparado con destino ("2 falta(n) · 1 sobra(n)"…; vacío si
 * está al día). `editorFields`: cuántos campos tienen otra apariencia del editor.
 */
export function contentTypeStatusParts(diff: ContentTypeDiff, dst: string, editorFields = 0): string[] {
  if (diff.missingCT) return [`no existe en ${dst}`];
  return [
    diff.info.length &&
      `${diff.info.map((i) => CT_INFO_LABEL[i.part]).join(', ')} ${diff.info.length > 1 ? 'distintos' : 'distinto'}`,
    diff.missing.length && `${diff.missing.length} falta(n)`,
    diff.extra.length && `${diff.extra.length} sobra(n)`,
    diff.mismatched.length && `${diff.mismatched.length} otro tipo`,
    diff.changedRules.length && `${diff.changedRules.length} con reglas distintas`,
    editorFields && `${editorFields} con otra apariencia`,
  ].filter((part): part is string => Boolean(part));
}

/** "1 content type nuevo · 2 campo(s) nuevo(s) · reglas de 1 campo(s) · apariencia de 1 campo(s)". */
export function modelPicksSummary(picks: Pick<ModelPick, 'kind'>[]): string {
  const count = (kind: ModelPick['kind']) => picks.filter((p) => p.kind === kind).length;
  return [
    count(CHANGE.CREATE) && `${count(CHANGE.CREATE)} content type(s) nuevo(s)`,
    count(CHANGE.INFO) && `datos de ${count(CHANGE.INFO)} content type(s)`,
    count(CHANGE.ADD) && `${count(CHANGE.ADD)} campo(s) nuevo(s)`,
    count(CHANGE.RULES) && `reglas de ${count(CHANGE.RULES)} campo(s)`,
    count(CHANGE.EDITOR) && `apariencia de ${count(CHANGE.EDITOR)} campo(s)`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Etiqueta y detalle de un cambio de modelo en la lista para marcar. */
export function modelPickText(pick: ModelPick, diff: ContentTypeDiff, dst: string): { label: string; hint: string } {
  const row = (fieldId: string) => diff.rows.find((r) => r.field.id === fieldId);
  const name = (fieldId: string) => row(fieldId)?.field.name ?? fieldId;
  switch (pick.kind) {
    case CHANGE.CREATE:
      return {
        label: `Crear «${diff.name}» con sus ${diff.missing.length} campos`,
        hint: diff.missing.map((f) => f.name).join(', '),
      };
    case CHANGE.INFO:
      return { label: `Datos de «${diff.name}»`, hint: ctInfoText(diff, dst) };
    case CHANGE.ADD:
      return { label: `Agregar el campo «${pick.field.name}»`, hint: `${fieldType(pick.field)} · falta en ${dst}` };
    case CHANGE.RULES: {
      const fieldRow = row(pick.field.id);
      return {
        label: `Reglas de «${pick.field.name}»`,
        hint: fieldRow ? ruleUpdateText(fieldRow) : 'reglas de origen',
      };
    }
    case CHANGE.EDITOR:
      return { label: `Apariencia de «${name(pick.editor.fieldId)}»`, hint: editorDiffText(pick.editor, dst) };
  }
}
