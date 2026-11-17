import type { ContentType, Field } from '../contentful/types.ts';
import { stableJson } from './json.ts';

/** Firma del tipo de un campo: si cambia entre ambientes, los valores no son compatibles. */
const fieldSig = (f: Field): string => [f.type, f.linkType, f.items?.type, f.items?.linkType].join('|');

export const fieldType = (f: Field): string =>
  f.type === 'Link'
    ? `Link ${f.linkType}`
    : f.type === 'Array'
      ? `Array<${f.items?.linkType ?? f.items?.type}>`
      : f.type;

export const FIELD = {
  OK: 'ok', // existe en ambos, igual
  RULES: 'rules', // mismo tipo, pero cambian reglas (nombre, obligatorio, localizado, validaciones)
  MISSING: 'missing', // falta en destino
  MISMATCH: 'mismatch', // existe en ambos con distinto tipo
  EXTRA: 'extra', // solo existe en destino
} as const;

export type FieldStatus = (typeof FIELD)[keyof typeof FIELD];

/** Diferencias de reglas entre un campo de origen y el mismo campo en destino. */
export interface RuleChanges {
  /** El campo tiene otro nombre visible en destino. */
  renamed: boolean;
  /** Obligatorio en destino pero no en origen: si queda vacío, la entry no se podrá publicar. */
  requiredOnlyInDst: boolean;
  /** Obligatorio en origen pero no en destino. */
  requiredOnlyInSrc: boolean;
  /** Localizado en origen pero no en destino: solo se copia el locale por defecto. */
  localizationLost: boolean;
  /** Localizado en destino pero no en origen. */
  localizedOnlyInDst: boolean;
  /** Validaciones que cambian, por nombre (`size`, `linkContentType`, `items.linkContentType`…). */
  validations: string[];
  /** Se puede editar en un ambiente y en el otro no (`disabled`). */
  editingDiffers: boolean;
  /** Sale en la API en un ambiente y en el otro no (`omitted`). */
  apiDiffers: boolean;
  /** Valor por defecto distinto. */
  defaultValueDiffers: boolean;
}

export interface FieldRow {
  field: Field;
  dstField: Field | undefined;
  status: FieldStatus;
  /** Solo cuando `status` es RULES. */
  rules?: RuleChanges;
}

/** Datos del content type (no de sus campos) que se comparan entre ambientes. */
export const CT_INFO = { NAME: 'name', DESCRIPTION: 'description', DISPLAY_FIELD: 'displayField' } as const;
export type CtInfoPart = (typeof CT_INFO)[keyof typeof CT_INFO];

/** Un dato del content type distinto en destino, con el valor de cada lado. */
export interface CtInfoChange {
  part: CtInfoPart;
  src: string | undefined;
  dst: string | undefined;
}

export interface ContentTypeDiff {
  id: string;
  name: string;
  /** El content type no existe en destino. */
  missingCT: boolean;
  /** Nombre, descripción o campo de título distintos en destino (vacío si no existe allá). */
  info: CtInfoChange[];
  /** Campos en el orden del modelo de origen; los que sobran en destino van al final. */
  rows: FieldRow[];
  missing: Field[];
  extra: Field[];
  mismatched: Field[];
  /** Mismo tipo, reglas distintas. */
  changedRules: Field[];
}

/** Validaciones de un campo (y de sus items, si es un Array) por nombre. Ignora los mensajes. */
function validationsOf(f: Field): Map<string, string> {
  const out = new Map<string, string>();
  const add = (list: object[] | undefined, prefix: string) => {
    for (const validation of list ?? []) {
      for (const [name, value] of Object.entries(validation)) {
        if (name !== 'message') out.set(prefix + name, stableJson(value));
      }
    }
  };
  add(f.validations, '');
  add(f.items?.validations, 'items.');
  return out;
}

/** Compara las reglas de un campo con el mismo tipo en ambos ambientes. `undefined` si son iguales. */
export function compareRules(src: Field, dst: Field): RuleChanges | undefined {
  const srcValidations = validationsOf(src);
  const dstValidations = validationsOf(dst);
  const names = new Set([...srcValidations.keys(), ...dstValidations.keys()]);
  const rules: RuleChanges = {
    renamed: src.name !== dst.name,
    requiredOnlyInDst: Boolean(dst.required && !src.required),
    requiredOnlyInSrc: Boolean(src.required && !dst.required),
    localizationLost: Boolean(src.localized && !dst.localized),
    localizedOnlyInDst: Boolean(dst.localized && !src.localized),
    validations: [...names].filter((name) => srcValidations.get(name) !== dstValidations.get(name)),
    editingDiffers: Boolean(src.disabled) !== Boolean(dst.disabled),
    apiDiffers: Boolean(src.omitted) !== Boolean(dst.omitted),
    defaultValueDiffers: stableJson(src.defaultValue ?? null) !== stableJson(dst.defaultValue ?? null),
  };
  const changed = Object.values(rules).some((value) => (Array.isArray(value) ? value.length > 0 : value));
  return changed ? rules : undefined;
}

/**
 * El campo de destino con las reglas de origen: nombre, obligatorio, localizado,
 * validaciones (también las de los items de un Array), si se puede editar, si sale en la
 * API y su valor por defecto. El ID y el tipo no cambian.
 */
export function withRulesOf(dst: Field, src: Field): Field {
  const { defaultValue: _, ...rest } = dst;
  return {
    ...rest,
    name: src.name,
    required: src.required,
    localized: src.localized,
    validations: src.validations ?? [],
    disabled: Boolean(src.disabled),
    omitted: Boolean(src.omitted),
    ...(src.defaultValue !== undefined && { defaultValue: src.defaultValue }),
    ...(dst.items && { items: { ...dst.items, validations: src.items?.validations ?? [] } }),
  };
}

/** Aplica a un campo de destino las reglas de `srcFields` con su mismo ID; los demás quedan igual. */
export function rulesFrom(srcFields: Field[]): (field: Field) => Field {
  const byId = new Map(srcFields.map((f) => [f.id, f]));
  return (field) => {
    const src = byId.get(field.id);
    return src ? withRulesOf(field, src) : field;
  };
}

/** Nombre, descripción y campo de título que difieren (un texto vacío cuenta como no tener). */
function infoChanges(srcCT: ContentType, dstCT: ContentType | undefined): CtInfoChange[] {
  if (!dstCT) return [];
  const value = (ct: ContentType, part: CtInfoPart) => ct[part] || undefined;
  return Object.values(CT_INFO).flatMap((part) => {
    const change = { part, src: value(srcCT, part), dst: value(dstCT, part) };
    return change.src === change.dst ? [] : [change];
  });
}

/** El content type de destino con el nombre, la descripción y el campo de título de origen. */
export function withInfoOf(dstCT: ContentType, srcCT: ContentType): ContentType {
  return { ...dstCT, name: srcCT.name, description: srcCT.description ?? '', displayField: srcCT.displayField };
}

/** Compara un content type de origen con el de destino (`undefined` si no existe allá). */
export function diffContentType(srcCT: ContentType, dstCT: ContentType | undefined): ContentTypeDiff {
  const dstById = new Map((dstCT?.fields ?? []).map((f) => [f.id, f]));
  const srcIds = new Set(srcCT.fields.map((f) => f.id));

  const rows: FieldRow[] = srcCT.fields.map((field) => {
    const dstField = dstById.get(field.id);
    if (!dstField) return { field, dstField, status: FIELD.MISSING };
    if (fieldSig(field) !== fieldSig(dstField)) return { field, dstField, status: FIELD.MISMATCH };
    const rules = compareRules(field, dstField);
    return rules ? { field, dstField, status: FIELD.RULES, rules } : { field, dstField, status: FIELD.OK };
  });
  for (const field of dstCT?.fields ?? []) {
    if (!srcIds.has(field.id)) rows.push({ field, dstField: field, status: FIELD.EXTRA });
  }

  const fieldsWith = (status: FieldStatus) => rows.filter((r) => r.status === status).map((r) => r.field);
  return {
    id: srcCT.sys.id,
    name: srcCT.name,
    missingCT: !dstCT,
    info: infoChanges(srcCT, dstCT),
    rows,
    missing: fieldsWith(FIELD.MISSING),
    extra: fieldsWith(FIELD.EXTRA),
    mismatched: fieldsWith(FIELD.MISMATCH),
    changedRules: fieldsWith(FIELD.RULES),
  };
}

/** El content type tiene alguna diferencia con destino. */
export const hasDifferences = (d: ContentTypeDiff): boolean =>
  d.missingCT || d.info.length + d.missing.length + d.extra.length + d.mismatched.length + d.changedRules.length > 0;

export interface ModelComparison {
  /** Content types de origen comparados con destino, ordenados por nombre. */
  diffs: ContentTypeDiff[];
  /** Content types que solo existen en destino. */
  onlyInDst: ContentType[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/** Compara los modelos de dos ambientes: todos los content types, o solo los de `ids`. */
export function compareModels(
  srcCTs: Map<string, ContentType>,
  dstCTs: Map<string, ContentType>,
  ids?: string[],
): ModelComparison {
  const wanted = ids?.length ? new Set(ids) : undefined;
  const include = (id: string) => !wanted || wanted.has(id);
  return {
    diffs: [...srcCTs.values()]
      .filter((ct) => include(ct.sys.id))
      .map((ct) => diffContentType(ct, dstCTs.get(ct.sys.id)))
      .sort(byName),
    onlyInDst: [...dstCTs.values()].filter((ct) => include(ct.sys.id) && !srcCTs.has(ct.sys.id)).sort(byName),
  };
}
