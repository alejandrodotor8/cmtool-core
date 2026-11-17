/**
 * Apariencia del editor (editor interface): el widget y los ajustes de cada campo, como el
 * help text. No es parte del modelo: Contentful la guarda aparte. Funciones puras.
 */
import type { EditorControl, EditorInterface, Field } from '../contentful/types.ts';
import { stableJson } from './json.ts';
import { type ContentTypeDiff, FIELD, fieldType } from './model.ts';

/** Widgets propios de Contentful: existen en todos los ambientes. */
const BUILTIN = 'builtin';
const isBuiltin = (c: EditorControl) => !c.widgetNamespace || c.widgetNamespace === BUILTIN;

/** El widget que usa Contentful cuando el control no dice cuál (por tipo de campo). */
const DEFAULT_WIDGET: Record<string, string> = {
  Symbol: 'singleLine',
  Text: 'markdown',
  RichText: 'richTextEditor',
  Integer: 'numberEditor',
  Number: 'numberEditor',
  Date: 'datePicker',
  Location: 'locationEditor',
  Boolean: 'boolean',
  Object: 'objectEditor',
  'Link Entry': 'entryLinkEditor',
  'Link Asset': 'assetLinkEditor',
  'Array<Symbol>': 'tagEditor',
  'Array<Entry>': 'entryLinksEditor',
  'Array<Asset>': 'assetLinksEditor',
};

/** Ajustes de los widgets de referencias (entries o archivos) cuando no se tocaron. */
const REFERENCE_DEFAULTS = { showCreateEntityAction: true, showLinkEntityAction: true, bulkEditing: false };

/**
 * Lo que vale cada ajuste de un widget cuando no está guardado. Contentful guarda estos
 * valores al confirmar la apariencia aunque no se cambien: guardados o no, se ven igual.
 */
const DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  entryLinkEditor: REFERENCE_DEFAULTS,
  entryLinksEditor: REFERENCE_DEFAULTS,
  entryCardEditor: REFERENCE_DEFAULTS,
  entryCardsEditor: REFERENCE_DEFAULTS,
  assetLinkEditor: REFERENCE_DEFAULTS,
  assetLinksEditor: REFERENCE_DEFAULTS,
  assetGalleryEditor: REFERENCE_DEFAULTS,
  boolean: { trueLabel: 'Yes', falseLabel: 'No' },
  rating: { stars: 5 },
  datePicker: { format: 'timeZ', ampm: '24' },
};

/** Qué parte de la apariencia de un campo difiere. */
export const EDITOR_PART = { HELP_TEXT: 'helpText', WIDGET: 'widget', SETTINGS: 'settings' } as const;
export type EditorPart = (typeof EDITOR_PART)[keyof typeof EDITOR_PART];

/** Un ajuste del widget con otro valor en destino (ya con los valores por defecto aplicados). */
export interface SettingChange {
  key: string;
  src: unknown;
  dst: unknown;
}

/** Un campo con otra apariencia en destino: qué difiere y los valores de cada lado. */
export interface EditorFieldDiff {
  fieldId: string;
  parts: EditorPart[];
  helpText: { src?: string; dst?: string };
  widget: { src?: string; dst?: string };
  settings: SettingChange[];
}

/**
 * Lo que se puede copiar de un control a otro ambiente. Un widget de Contentful se copia
 * con sus ajustes; el de una app o extensión (que podría no estar instalada en destino)
 * no: solo su help text, y destino usa el widget por defecto.
 */
export function portableControl({ fieldId, widgetId, widgetNamespace, settings }: EditorControl): EditorControl {
  if (!widgetNamespace || widgetNamespace === BUILTIN) {
    return {
      fieldId,
      ...(widgetId !== undefined && { widgetId }),
      ...(widgetNamespace !== undefined && { widgetNamespace }),
      ...(settings !== undefined && { settings }),
    };
  }
  const helpText = settings?.helpText;
  return helpText === undefined ? { fieldId } : { fieldId, settings: { helpText } };
}

/** El help text, o `undefined` si no hay (un texto vacío cuenta como no tener). */
const helpTextOf = (c: EditorControl | undefined): string | undefined => {
  const text = c?.settings?.helpText;
  return typeof text === 'string' && text.trim() ? text : undefined;
};

/** El widget, con el de por defecto si el control no lo dice. */
const widgetOf = (c: EditorControl | undefined, field: Field): string | undefined => {
  const id = c?.widgetId ?? DEFAULT_WIDGET[fieldType(field)];
  return id && c && !isBuiltin(c) ? `${c.widgetNamespace}:${id}` : id;
};

/**
 * Los ajustes del widget como se ven en Contentful: los valores por defecto del widget,
 * con los guardados encima. Sin el help text ni valores vacíos.
 */
function effectiveSettings(c: EditorControl | undefined, widget: string | undefined): Record<string, unknown> {
  const own = Object.entries(c?.settings ?? {}).filter(
    ([key, value]) => key !== 'helpText' && value !== undefined && value !== null && value !== '',
  );
  return { ...(widget ? DEFAULT_SETTINGS[widget] : {}), ...Object.fromEntries(own) };
}

/** Los ajustes que tienen otro valor en destino. */
function settingChanges(src: Record<string, unknown>, dst: Record<string, unknown>): SettingChange[] {
  const keys = [...new Set([...Object.keys(src), ...Object.keys(dst)])].sort();
  return keys
    .filter((key) => stableJson(src[key] ?? null) !== stableJson(dst[key] ?? null))
    .map((key) => ({ key, src: src[key], dst: dst[key] }));
}

/**
 * Qué difiere entre la apariencia de un campo en origen y en destino, mirando solo lo que
 * se copiaría: de un widget de app o extensión de origen, solo el help text.
 */
function fieldEditorDiff(src: EditorControl, dst: EditorControl | undefined, field: Field): EditorFieldDiff {
  const helpText = { src: helpTextOf(src), dst: helpTextOf(dst) };
  const widget = { src: widgetOf(src, field), dst: widgetOf(dst, field) };
  const parts: EditorPart[] = [];
  let settings: SettingChange[] = [];
  if (helpText.src !== helpText.dst) parts.push(EDITOR_PART.HELP_TEXT);
  if (isBuiltin(src)) {
    // Sin widget conocido en un lado (tipo de campo sin widget por defecto conocido), no se compara.
    const widgetKnown = widget.src !== undefined && widget.dst !== undefined;
    if (widgetKnown && widget.src !== widget.dst) parts.push(EDITOR_PART.WIDGET);
    settings = settingChanges(effectiveSettings(src, widget.src), effectiveSettings(dst, widget.dst));
    if (settings.length) parts.push(EDITOR_PART.SETTINGS);
  }
  return { fieldId: field.id, parts, helpText, widget, settings };
}

/** De `fields`, los que tienen otra apariencia en destino. Sin control en origen no hay nada que copiar. */
export function editorDifferences(
  src: EditorInterface | undefined,
  dst: EditorInterface | undefined,
  fields: Field[],
): EditorFieldDiff[] {
  const byField = (ei: EditorInterface | undefined) => new Map((ei?.controls ?? []).map((c) => [c.fieldId, c]));
  const srcControls = byField(src);
  const dstControls = byField(dst);
  return fields.flatMap((field) => {
    const srcControl = srcControls.get(field.id);
    if (!srcControl) return [];
    const diff = fieldEditorDiff(srcControl, dstControls.get(field.id), field);
    return diff.parts.length ? [diff] : [];
  });
}

/** El control de destino con la apariencia de origen. De una app o extensión solo se copia el help text. */
function copiedControl(src: EditorControl, dst: EditorControl | undefined): EditorControl {
  if (isBuiltin(src)) return portableControl(src);
  const { helpText: _, ...settings } = dst?.settings ?? {};
  const helpText = helpTextOf(src);
  const merged = helpText === undefined ? settings : { ...settings, helpText };
  const base = dst ?? { fieldId: src.fieldId };
  const { settings: _old, ...rest } = base;
  return Object.keys(merged).length ? { ...rest, settings: merged } : rest;
}

/** Los controles de destino con la apariencia de origen copiada en `fieldIds`; el resto no se toca. */
export function mergeControls(
  dstControls: EditorControl[] | undefined,
  srcControls: EditorControl[] | undefined,
  fieldIds: Set<string>,
): EditorControl[] {
  const src = new Map((srcControls ?? []).map((c) => [c.fieldId, c]));
  const copy = (id: string, dst?: EditorControl) => {
    const control = src.get(id);
    return control && fieldIds.has(id) ? copiedControl(control, dst) : undefined;
  };
  const merged = (dstControls ?? []).map((c) => copy(c.fieldId, c) ?? c);
  const present = new Set(merged.map((c) => c.fieldId));
  for (const id of fieldIds) {
    const control = copy(id);
    if (control && !present.has(id)) merged.push(control);
  }
  return merged;
}

/**
 * Por content type, los campos que existen en ambos modelos (mismo tipo) pero tienen otra
 * apariencia en destino. Los content types que no existen en destino no se incluyen.
 */
export function editorDiffsFor(
  diffs: Iterable<ContentTypeDiff>,
  src: Map<string, EditorInterface>,
  dst: Map<string, EditorInterface>,
): Map<string, EditorFieldDiff[]> {
  const result = new Map<string, EditorFieldDiff[]>();
  for (const diff of diffs) {
    if (diff.missingCT) continue;
    const shared = diff.rows.filter((r) => r.status === FIELD.OK || r.status === FIELD.RULES).map((r) => r.field);
    const fieldDiffs = editorDifferences(src.get(diff.id), dst.get(diff.id), shared);
    if (fieldDiffs.length) result.set(diff.id, fieldDiffs);
  }
  return result;
}
