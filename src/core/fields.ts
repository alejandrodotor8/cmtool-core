/**
 * Transforma valores de origen al formato que acepta destino. Funciones puras.
 */
import type { Asset, ContentType, Entry, Field, Locales, TagLink } from '../contentful/types.ts';
import type { ContentTypeDiff } from './model.ts';

type ByLocale<T = unknown> = Record<string, T>;

const pickLocales = <T>(byLocale: ByLocale<T> | undefined, keep: (locale: string) => boolean): ByLocale<T> =>
  Object.fromEntries(Object.entries(byLocale ?? {}).filter(([locale]) => keep(locale)));

const isEmpty = (obj: object): boolean => Object.keys(obj).length === 0;

/** El modelo de origen de una entry y sus idiomas: dicen qué valores trae origen. */
export interface SourceModel {
  locales: Locales;
  /** Sin content type, cada campo se trata como localizado en origen. */
  ct?: ContentType;
}

const sourceField = (source: SourceModel | undefined, id: string) => source?.ct?.fields.find((f) => f.id === id);

/**
 * Los idiomas de un campo de los que origen trae valor: todos los de origen si el campo
 * está localizado allá; si no, solo el idioma por defecto (es su único valor).
 */
function sourceLocalesOf(source: SourceModel, id: string): Set<string> {
  const field = sourceField(source, id);
  return field && !field.localized && source.locales.default ? new Set([source.locales.default]) : source.locales.codes;
}

/**
 * Campos que se escriben: los que existen en ambos modelos con el mismo tipo.
 * Los que solo existen en destino (o tienen otro tipo) no se tocan, así conservan su valor.
 */
export function writableFields(dstCT: ContentType, diff: ContentTypeDiff | undefined): Map<string, Field> {
  const skip = new Set([...(diff?.mismatched ?? []), ...(diff?.extra ?? [])].map((f) => f.id));
  return new Map(dstCT.fields.filter((f) => !skip.has(f.id)).map((f) => [f.id, f]));
}

/**
 * Valores de una entry de origen listos para destino.
 * - Solo los campos de `writable` (existen en ambos modelos con el mismo tipo).
 * - Campo localizado en destino: solo los locales que existan en destino.
 * - Campo no localizado en destino: solo su locale por defecto. Si en origen tampoco está
 *   localizado y los idiomas por defecto son distintos, su único valor pasa al de destino.
 */
export function fieldsForDestination(
  entry: Entry,
  writable: Map<string, Field>,
  dstLocales: Locales,
  source?: SourceModel,
): Entry['fields'] {
  const out: Entry['fields'] = {};
  for (const [id, byLocale] of Object.entries<ByLocale>(entry.fields ?? {})) {
    const field = writable.get(id);
    if (!field) continue;
    const value = field.localized
      ? pickLocales(byLocale, (l) => dstLocales.codes.has(l))
      : singleValue(byLocale, id, dstLocales, source);
    if (!isEmpty(value)) out[id] = value;
  }
  return out;
}

/** El valor de un campo no localizado en destino, en su idioma por defecto. */
function singleValue(byLocale: ByLocale, id: string, dstLocales: Locales, source?: SourceModel): ByLocale {
  const target = dstLocales.default;
  if (!target) return {};
  if (byLocale[target] !== undefined) return { [target]: byLocale[target] };
  const srcField = sourceField(source, id);
  const srcDefault = source?.locales.default;
  return srcField && !srcField.localized && srcDefault && byLocale[srcDefault] !== undefined
    ? { [target]: byLocale[srcDefault] }
    : {};
}

/**
 * Mezcla con la entry que ya existe en destino. En los campos que se migran manda el
 * origen, pero solo en los idiomas de los que origen trae valor: lo demás (campos de sobra
 * o de otro tipo, idiomas que origen no tiene, traducciones de un campo que en origen no
 * está localizado) se conserva.
 */
export function mergeWithExisting(
  current: Entry['fields'],
  incoming: Entry['fields'],
  writable: Map<string, Field>,
  source: SourceModel,
): Entry['fields'] {
  const merged: Entry['fields'] = { ...current };
  for (const id of writable.keys()) {
    const covered = sourceLocalesOf(source, id);
    const value = { ...pickLocales(current[id], (l) => !covered.has(l)), ...incoming[id] };
    if (isEmpty(value)) delete merged[id];
    else merged[id] = value;
  }
  return merged;
}

/** Los tags de destino más los de origen: actualizar nunca quita un tag. */
export function mergeTags(current: TagLink[], incoming: TagLink[]): TagLink[] {
  const ids = new Set(current.map((t) => t.sys.id));
  return [...current, ...incoming.filter((t) => !ids.has(t.sys.id))];
}

/** Archivo, título y descripción de un asset de origen, para crearlo igual en destino. */
export function assetFieldsForDestination(asset: Asset, dstLocales: Locales): Asset['fields'] {
  const inDst = (l: string) => dstLocales.codes.has(l);
  const file: Asset['fields']['file'] = {};
  for (const [locale, f] of Object.entries(pickLocales(asset.fields.file, inDst))) {
    file[locale] = { contentType: f.contentType, fileName: f.fileName, upload: contentfulFileUrl(f) };
  }
  const fields = {
    file,
    ...(asset.fields.title && { title: pickLocales(asset.fields.title, inDst) }),
    ...(asset.fields.description && { description: pickLocales(asset.fields.description, inDst) }),
  };
  // El tipo marca `title` como obligatorio, pero un asset sin título no lo trae; se envía igual que en origen.
  return fields as Asset['fields'];
}

/**
 * URL https del archivo en el CDN de Contentful (*.ctfassets.net). Destino descarga el
 * archivo desde ahí; cualquier otro origen se rechaza.
 */
function contentfulFileUrl(file: { url?: string; upload?: string }): string {
  const raw = file.url ?? file.upload ?? '';
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    /* se rechaza abajo */
  }
  if (parsed?.protocol !== 'https:' || !parsed.hostname.endsWith('.ctfassets.net')) {
    throw new Error(`el archivo no está en el CDN de Contentful (${url || 'sin URL'})`);
  }
  return url;
}
