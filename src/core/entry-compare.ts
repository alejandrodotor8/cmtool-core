/**
 * Comparación de una entry entre dos ambientes, campo por campo. Funciones puras.
 */
import type { ContentType, Entry, Field, Locales } from '../contentful/types.ts';
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
  /** En destino el campo tiene otro tipo: la migración no lo escribe y conserva su valor. */
  skipped?: boolean;
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
 * Cómo quedaría cada campo de una entry en destino si se escribe: los que cambian, los que
 * siguen igual (`SAME`) y los que no se migran porque en destino tienen otro tipo (`skipped`).
 * Arma la entry con las mismas reglas con que se escribe (campos con el mismo tipo, idiomas de
 * destino, lo que solo existe allá se conserva) y la compara con la actual. Va en el orden del
 * modelo de origen, con los tags al final, y omite los campos vacíos en los dos lados.
 * - Sin `dst`, la entry se crea: cada campo con valor llega nuevo (`ONLY_SRC`).
 * - Los campos que faltan en el modelo de destino van marcados `newField`: se escriben si se agregan.
 * - Sin content type en destino, se toma el de origen: así se crearía.
 */
export function migrationFields(
  src: Entry,
  dst: Entry | undefined,
  { srcCT, dstCT, locales }: MigrationModel,
): FieldComparison[] {
  if (!srcCT) return [];
  const diff = diffContentType(srcCT, dstCT);
  const writable = dstCT ? writableFields(dstCT, diff) : new Map<string, Field>();
  for (const field of diff.missing) writable.set(field.id, field);
  // Con el content type entero por crear, ningún campo es "nuevo" por separado.
  const newFields = new Set(dstCT ? diff.missing.map((f) => f.id) : []);

  const source = { locales: locales.src, ct: srcCT };
  const current = dst?.fields ?? {};
  const incoming = fieldsForDestination(src, writable, locales.dst, source);
  const projected = dst ? mergeWithExisting(current, incoming, writable, source) : incoming;

  const fields = srcCT.fields.flatMap((f): FieldComparison[] => {
    if (!writable.has(f.id)) {
      const kept = compareValues(f.id, f.name, src.fields?.[f.id], current[f.id]);
      return kept ? [{ ...kept, skipped: true }] : [];
    }
    const row = compareValues(f.id, f.name, projected[f.id], current[f.id]);
    if (!row) return [];
    return [newFields.has(f.id) ? { ...row, newField: true } : row];
  });
  return [...fields, ...tagFields(src, dst)];
}

/** El campo cambia en destino al escribir la entry: no sigue igual ni se salta. */
export const isFieldChange = (field: FieldComparison): boolean => field.status !== VALUE.SAME && !field.skipped;

/**
 * Lo que una migración cambiaría en una entry que ya existe en destino: los campos de
 * `migrationFields` que cambian. También cuenta si origen tiene tags que destino no tiene.
 */
export function migrationChanges(src: Entry, dst: Entry, model: MigrationModel): FieldComparison[] {
  if (!model.srcCT || !model.dstCT) return [];
  return migrationFields(src, dst, model).filter(isFieldChange);
}

/** Los tags al escribir: se agregan los de origen que faltan y ninguno se quita. */
function tagFields(src: Entry, dst: Entry | undefined): FieldComparison[] {
  const ids = (e: Entry | undefined) => (e?.metadata?.tags ?? []).map((t) => t.sys.id);
  const current = ids(dst);
  const incoming = ids(src);
  if (!incoming.length) return [];
  const added = incoming.filter((id) => !current.includes(id));
  const status = !added.length ? VALUE.SAME : current.length ? VALUE.DIFFERENT : VALUE.ONLY_SRC;
  return [{ id: TAGS, name: 'Tags', status, src: [...current, ...added], dst: current }];
}
