/**
 * Comparación de una entry entre dos ambientes, campo por campo. Funciones puras.
 */
import type { ContentType, Entry, Locales } from '../contentful/types.ts';
import { fieldsForDestination, mergeWithExisting, writableFields } from './fields.ts';
import { exactJson } from './json.ts';
import { diffContentType } from './model.ts';

export const VALUE = {
  SAME: 'same',
  DIFFERENT: 'different',
  ONLY_SRC: 'only-src', // tiene valor en origen y no en destino
  ONLY_DST: 'only-dst', // tiene valor en destino y no en origen
} as const;

export type ValueStatus = (typeof VALUE)[keyof typeof VALUE];

export interface FieldComparison {
  id: string;
  name: string;
  status: ValueStatus;
  src: unknown;
  dst: unknown;
  /** El campo falta en el modelo de destino: el cambio solo se aplica si se agrega. */
  newField?: boolean;
}

/** ID con el que se comparan los tags de una entry (no son un campo del modelo). */
export const TAGS = 'metadata.tags';

/** Compara dos valores; `undefined` si son iguales (el orden de las claves no cuenta). */
function compareValues(id: string, name: string, a: unknown, b: unknown): FieldComparison | undefined {
  if (a === undefined && b === undefined) return undefined;
  const status =
    b === undefined
      ? VALUE.ONLY_SRC
      : a === undefined
        ? VALUE.ONLY_DST
        : exactJson(a) === exactJson(b)
          ? VALUE.SAME
          : VALUE.DIFFERENT;
  return { id, name, status, src: a, dst: b };
}

/**
 * Compara los valores de cada campo, en el orden del modelo de origen; los campos que no
 * están en ese modelo van al final. Omite campos vacíos en ambos lados.
 * - `locales`: solo compara esos locales (por ejemplo, los de origen: los demás no se migran).
 * - `modelOnly`: solo los campos del modelo de origen (los que la migración puede escribir).
 */
export function compareEntryFields(
  src: Entry,
  dst: Entry,
  ct: ContentType | undefined,
  { locales, modelOnly = false }: { locales?: Set<string>; modelOnly?: boolean } = {},
): FieldComparison[] {
  const names = new Map((ct?.fields ?? []).map((f) => [f.id, f.name]));
  const ids = modelOnly
    ? [...names.keys()]
    : [...new Set([...names.keys(), ...Object.keys(src.fields ?? {}), ...Object.keys(dst.fields ?? {})])];
  const pick = (value: unknown) => (locales ? onlyLocales(value, locales) : value);

  return ids.flatMap(
    (id) => compareValues(id, names.get(id) ?? id, pick(src.fields?.[id]), pick(dst.fields?.[id])) ?? [],
  );
}

/** Resumen corto de un valor para mostrarlo en una tabla. */
export function summarizeValue(value: unknown, max = 40): string {
  const text = describe(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function describe(value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value.replace(/\s+/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length}] ${value.slice(0, 3).map(describe).join(', ')}`;
  const obj = value as { sys?: { type?: string; id?: string }; nodeType?: string };
  if (obj.sys?.type === 'Link') return `→ ${obj.sys.id}`;
  if (obj.nodeType === 'document') return `rich text: ${richTextPlain(value)}`;
  const entries = Object.entries(value as Record<string, unknown>);
  // Valor por locale ({ "es-CO": … }): se muestra el primero.
  if (entries.length && entries.every(([k]) => /^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(k))) {
    const [, first] = entries[0] as [string, unknown];
    return entries.length > 1 ? `${describe(first)} (+${entries.length - 1} idiomas)` : describe(first);
  }
  return exactJson(value);
}

function richTextPlain(node: unknown): string {
  const n = node as { value?: string; content?: unknown[] };
  return [n.value ?? '', ...(n.content ?? []).map(richTextPlain)].join(' ').replace(/\s+/g, ' ').trim();
}

/** El valor por locale solo con `locales`; `undefined` si no queda ninguno. */
function onlyLocales(value: unknown, locales: Set<string>): unknown {
  if (!value || typeof value !== 'object') return value;
  const kept = Object.entries(value as Record<string, unknown>).filter(([locale]) => locales.has(locale));
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/** Modelos e idiomas de los dos ambientes, para saber qué escribiría una migración. */
export interface MigrationModel {
  srcCT: ContentType | undefined;
  dstCT: ContentType | undefined;
  locales: { src: Locales; dst: Locales };
}

/**
 * Lo que una migración cambiaría en una entry que ya existe en destino. Arma la entry como
 * quedaría (con las mismas reglas con que se escribe: campos con el mismo tipo, idiomas de
 * destino, lo que solo existe allá se conserva) y la compara con la actual. Los campos que
 * faltan en el modelo de destino cuentan, marcados como `newField`: se escriben si se agregan.
 * También cuenta si origen tiene tags que la entry no tiene en destino.
 */
export function migrationChanges(src: Entry, dst: Entry, { srcCT, dstCT, locales }: MigrationModel): FieldComparison[] {
  if (!srcCT || !dstCT) return [];
  const diff = diffContentType(srcCT, dstCT);
  const writable = writableFields(dstCT, diff);
  for (const field of diff.missing) writable.set(field.id, field);
  const newFields = new Set(diff.missing.map((f) => f.id));

  const source = { locales: locales.src, ct: srcCT };
  const current = dst.fields ?? {};
  const incoming = fieldsForDestination(src, writable, locales.dst, source);
  const projected = mergeWithExisting(current, incoming, writable, source);

  const fields = srcCT.fields
    .filter((f) => writable.has(f.id))
    .flatMap((f) => {
      const change = compareValues(f.id, f.name, projected[f.id], current[f.id]);
      if (!change || change.status === VALUE.SAME) return [];
      return [newFields.has(f.id) ? { ...change, newField: true } : change];
    });
  return [...fields, ...tagChanges(src, dst)];
}

/** Tags de origen que la entry no tiene en destino (al actualizar se agregan; ninguno se quita). */
function tagChanges(src: Entry, dst: Entry): FieldComparison[] {
  const ids = (e: Entry) => (e.metadata?.tags ?? []).map((t) => t.sys.id);
  const current = ids(dst);
  const added = ids(src).filter((id) => !current.includes(id));
  if (!added.length) return [];
  return [
    {
      id: TAGS,
      name: 'Tags',
      status: current.length ? VALUE.DIFFERENT : VALUE.ONLY_SRC,
      src: [...current, ...added],
      dst: current,
    },
  ];
}
