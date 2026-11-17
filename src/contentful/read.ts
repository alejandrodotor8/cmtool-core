/**
 * Lecturas del CMA. Nada de este módulo escribe en Contentful.
 */
import { LIMITS } from '../config.ts';
import { childEntryIds, hyperlinkedEntryIds } from '../core/entries.ts';
import { AbortError } from '../errors.ts';
import type {
  Asset,
  Cma,
  ContentType,
  EditorInterface,
  Entry,
  EntryTree,
  Environment,
  Locales,
  Space,
  Tag,
} from './types.ts';

/** Las entries pueden ser pesadas (rich text); lotes más chicos evitan respuestas demasiado grandes. */
const ENTRY_BATCH = 50;
const ASSET_BATCH = 100;

const chunk = <T>(arr: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

type IdQuery = { 'sys.id[in]': string; limit: number };

/** Trae por ID, en lotes, lo que exista. Lo que no existe simplemente no viene. */
async function fetchInBatches<T extends { sys: { id: string } }>(
  ids: Iterable<string>,
  batch: number,
  get: (query: IdQuery) => Promise<{ items: T[] }>,
): Promise<Map<string, T>> {
  const found = new Map<string, T>();
  for (const part of chunk([...ids], batch)) {
    const res = await get({ 'sys.id[in]': part.join(','), limit: part.length });
    for (const item of res.items) found.set(item.sys.id, item);
  }
  return found;
}

export const fetchEntries = (cma: Cma, environmentId: string, ids: Iterable<string>): Promise<Map<string, Entry>> =>
  fetchInBatches(ids, ENTRY_BATCH, (query) => cma.entry.getMany({ environmentId, query }));

export const fetchAssets = (cma: Cma, environmentId: string, ids: Iterable<string>): Promise<Map<string, Asset>> =>
  fetchInBatches(ids, ASSET_BATCH, (query) => cma.asset.getMany({ environmentId, query }));

export async function listSpaces(cma: Cma): Promise<Space[]> {
  return (await cma.space.getMany({ query: { limit: 100 } })).items;
}

/** Ambientes utilizables del space, con los aliases que apuntan a cada uno. */
export async function listEnvironments(cma: Cma): Promise<Environment[]> {
  const envs = (await cma.environment.getMany({ query: { limit: 100 } })).items.filter(
    (e) => e.sys.status?.sys?.id !== 'failed',
  );
  let aliases: { sys: { id: string }; environment: { sys: { id: string } } }[] = [];
  try {
    aliases = (await cma.environmentAlias.getMany({})).items;
  } catch {
    /* el space no usa aliases */
  }
  return envs.map((e) => ({
    id: e.sys.id,
    aliases: aliases.filter((a) => a.environment.sys.id === e.sys.id).map((a) => a.sys.id),
  }));
}

/**
 * Lee en origen las entries que pegaste y, nivel por nivel, todas las que cuelgan de ellas.
 * Si una de las que pegaste no existe, se detiene.
 */
export async function readEntryTree(cma: Cma, environmentId: string, rootIds: string[]): Promise<EntryTree> {
  const entries = new Map<string, Entry>();
  const children = new Map<string, string[]>();
  const hyperlinks = new Map<string, string[]>();
  const broken = new Set<string>();

  let level = [...rootIds];
  while (level.length) {
    const found = await fetchEntries(cma, environmentId, level);
    const next: string[] = [];
    const missingRoots = level.filter((id) => !found.has(id) && rootIds.includes(id));
    if (missingRoots.length) {
      throw new AbortError(
        `${missingRoots.length === 1 ? 'Esta entry no existe' : `Estas ${missingRoots.length} entries no existen`} en ${environmentId}: ${missingRoots.join(', ')}`,
        'Revisa los IDs (o que estés en el space y ambiente correctos) y vuelve a correr.',
      );
    }
    for (const id of level) {
      const entry = found.get(id);
      if (!entry) {
        broken.add(id);
        continue;
      }
      const kids = childEntryIds(entry);
      entries.set(id, entry);
      children.set(id, kids);
      hyperlinks.set(id, hyperlinkedEntryIds(entry));
      next.push(...kids);
    }
    if (entries.size > LIMITS.maxTreeEntries) {
      throw new AbortError(
        `El árbol pasa de ${LIMITS.maxTreeEntries} entries.`,
        'Revisa los IDs: puede que un link esté arrastrando una página entera.',
      );
    }
    level = [...new Set(next)].filter((id) => !entries.has(id) && !broken.has(id));
  }
  return { entries, children, hyperlinks, broken };
}

/** Todos los content types del ambiente, por ID. */
export async function readContentTypes(cma: Cma, environmentId: string): Promise<Map<string, ContentType>> {
  const all = new Map<string, ContentType>();
  for (let skip = 0; ; ) {
    const res = await cma.contentType.getMany({ environmentId, query: { limit: 1000, skip } });
    for (const ct of res.items) all.set(ct.sys.id, ct);
    skip += res.items.length;
    if (!res.items.length || skip >= res.total) break;
  }
  return all;
}

export async function readLocales(cma: Cma, environmentId: string): Promise<Locales> {
  const items = (await cma.locale.getMany({ environmentId, query: { limit: 100 } })).items;
  return {
    codes: new Set(items.map((l) => l.code)),
    default: items.find((l) => l.default)?.code,
    required: new Set(items.filter((l) => l.default || !l.optional).map((l) => l.code)),
  };
}

export async function readTags(cma: Cma, environmentId: string): Promise<Map<string, Tag>> {
  const res = await cma.tag.getMany({ environmentId, query: { limit: 1000 } });
  return new Map(res.items.map((t) => [t.sys.id, t]));
}

/** Una sola llamada: las entries de origen que cumplen los filtros (ver core/query.ts). */
export async function searchEntries(
  cma: Cma,
  environmentId: string,
  query: Record<string, string | number | boolean>,
): Promise<Entry[]> {
  return (await cma.entry.getMany({ environmentId, query })).items;
}

/** Una sola llamada: assets cuyo título o archivo coinciden con el texto. */
export async function searchAssets(cma: Cma, environmentId: string, text: string, limit: number): Promise<Asset[]> {
  const query = { query: text, limit, order: '-sys.updatedAt', 'sys.archivedAt[exists]': false };
  return (await cma.asset.getMany({ environmentId, query })).items;
}

/**
 * Todas las entries que cumplen los filtros, página por página (`pageSize` por llamada).
 * Si pasan de `max`, se detiene: con tantos resultados conviene filtrar más.
 */
export async function listEntries(
  cma: Cma,
  environmentId: string,
  query: Record<string, string | number | boolean>,
  { pageSize, max }: { pageSize: number; max: number },
): Promise<Entry[]> {
  const all: Entry[] = [];
  for (let skip = 0; ; skip += pageSize) {
    const res = await cma.entry.getMany({ environmentId, query: { ...query, limit: pageSize, skip } });
    all.push(...res.items);
    if (all.length > max) {
      throw new AbortError(
        `Hay más de ${max} entries con esos filtros.`,
        'Filtra más (por ejemplo, con una fecha) para no recorrer todo el ambiente.',
      );
    }
    if (res.items.length < pageSize || all.length >= res.total) return all;
  }
}

/** Usuario de la sesión: separa respaldos por cuenta y sirve para "solo las que editaste tú". */
export async function currentUser(cma: Cma): Promise<{ id: string; email: string | undefined }> {
  const user = await cma.user.getCurrent();
  return { id: user.sys.id, email: user.email };
}

/** La apariencia del editor de todos los content types del ambiente, por content type (1 llamada). */
export async function readEditorInterfaces(cma: Cma, environmentId: string): Promise<Map<string, EditorInterface>> {
  const res = await cma.editorInterface.getMany({ environmentId, query: { limit: 1000 } });
  return new Map(res.items.map((ei) => [ei.sys.contentType.sys.id, ei]));
}
