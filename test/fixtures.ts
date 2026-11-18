/** Constructores mínimos de objetos de Contentful para los tests. */
import type { Analysis } from '../src/analyze.ts';
import type {
  Asset,
  Cma,
  ContentType,
  EditorInterface,
  Entry,
  EntryTree,
  Field,
  Locales,
  Tag,
} from '../src/contentful/types.ts';
import { childEntryIds, contentTypeOf, hyperlinkedEntryIds, isArchived, makeTitleOf } from '../src/core/entries.ts';
import { migrationChanges } from '../src/core/entry-compare.ts';
import { diffContentType } from '../src/core/model.ts';
import { classifyTree, writtenEntries } from '../src/core/plan.ts';

export const link = (id: string, linkType: 'Entry' | 'Asset' = 'Entry') => ({ sys: { type: 'Link', linkType, id } });

export const entry = (
  id: string,
  contentType: string,
  fields: Record<string, Record<string, unknown>> = {},
  tags: string[] = [],
): Entry =>
  ({
    sys: { id, contentType: { sys: { id: contentType } } },
    fields,
    metadata: { tags: tags.map((t) => ({ sys: { type: 'Link', linkType: 'Tag', id: t } })) },
  }) as unknown as Entry;

export const field = (id: string, type = 'Symbol', extra: Partial<Field> = {}): Field => ({
  id,
  name: id,
  type,
  localized: false,
  required: false,
  ...extra,
});

export const contentType = (id: string, fields: Field[], displayField = 'title'): ContentType =>
  ({ sys: { id }, name: id, description: '', displayField, fields }) as unknown as ContentType;

export const asset = (
  id: string,
  file: Record<string, { url?: string; upload?: string }>,
  title?: Record<string, string>,
): Asset => {
  const files = Object.fromEntries(
    Object.entries(file).map(([locale, f]) => [locale, { fileName: `${id}.jpg`, contentType: 'image/jpeg', ...f }]),
  );
  return { sys: { id }, fields: { file: files, ...(title && { title }) } } as unknown as Asset;
};

export const tag = (id: string): Tag => ({ sys: { id, visibility: 'public' }, name: id }) as unknown as Tag;

export const locales = (codes: string[], def = codes[0], required = def ? [def] : []): Locales => ({
  codes: new Set(codes),
  default: def,
  required: new Set(required),
});

/** Árbol a partir de las entries de origen; los hijos salen de sus links. */
export function treeOf(entries: Entry[], broken: string[] = []): EntryTree {
  return {
    entries: new Map(entries.map((e) => [e.sys.id, e])),
    children: new Map(entries.map((e) => [e.sys.id, childEntryIds(e)])),
    hyperlinks: new Map(entries.map((e) => [e.sys.id, hyperlinkedEntryIds(e)])),
    broken: new Set(broken),
  };
}

/** Análisis armado con las mismas funciones que usa la herramienta, sin red. */
export function analysisOf({
  rootIds,
  entries,
  existsInDst = [],
  dstEntries = [],
  srcCTs,
  dstCTs = [],
  srcAssets = [],
  existingAssets = [],
  missingTags = [],
}: {
  rootIds: string[];
  entries: Entry[];
  /** IDs que existen en destino (sin campos). */
  existsInDst?: string[];
  /** Entries que existen en destino, con sus campos. */
  dstEntries?: Entry[];
  srcCTs: ContentType[];
  dstCTs?: ContentType[];
  srcAssets?: Asset[];
  existingAssets?: string[];
  missingTags?: Tag[];
}): Analysis {
  const tree = treeOf(entries);
  const exists = new Set([...existsInDst, ...dstEntries.map((e) => e.sys.id)]);
  const actions = classifyTree(rootIds, tree, exists);
  const contentTypes = {
    src: new Map(srcCTs.map((ct) => [ct.sys.id, ct])),
    dst: new Map(dstCTs.map((ct) => [ct.sys.id, ct])),
  };
  const diffs = new Map(
    [...new Set(entries.map(contentTypeOf))].map((id) => [
      id,
      diffContentType(contentTypes.src.get(id) as ContentType, contentTypes.dst.get(id)),
    ]),
  );
  const ids = srcAssets.map((a) => a.sys.id);
  const loc = locales(['es-CO']);
  const dstById = new Map(dstEntries.map((e) => [e.sys.id, e]));
  const changes = new Map(
    [...dstById].flatMap(([id, current]) => {
      const source = tree.entries.get(id);
      return source
        ? [
            [
              id,
              migrationChanges(source, current, {
                srcCT: contentTypes.src.get(contentTypeOf(source)),
                dstCT: contentTypes.dst.get(contentTypeOf(source)),
                locales: { src: loc, dst: loc },
              }),
            ] as const,
          ]
        : [];
    }),
  );
  const analysis: Analysis = {
    src: 'develop',
    dst: 'qa',
    rootIds,
    tree,
    dstEntries: dstById,
    changes,
    existsInDst: exists,
    archivedInDst: new Set(dstEntries.filter(isArchived).map((e) => e.sys.id)),
    actions,
    contentTypes,
    diffs,
    locales: { src: loc, dst: loc, missing: [] },
    assets: {
      ids,
      src: new Map(srcAssets.map((a) => [a.sys.id, a])),
      existing: new Set(existingAssets),
      missing: ids.filter((id) => !existingAssets.includes(id)),
    },
    tags: { dstIds: new Set(), missing: missingTags },
    titleOf: makeTitleOf(contentTypes.src, 'es-CO'),
  };
  return analysis;
}

/** IDs de las entries que se escriben, para comparar en los tests. */
export const writtenIds = (analysis: Analysis): string[] => writtenEntries(analysis).map((e) => e.sys.id);

export interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
  data: unknown;
}

/**
 * CMA falso que registra cada llamada. `entries` alimenta `entry.getMany` / `entry.get`;
 * las escrituras devuelven lo que recibieron con un `sys` mínimo.
 */
export function fakeCma(
  entries: Entry[] = [],
  editorInterfaces: Map<string, EditorInterface> = new Map(),
): { cma: Cma; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const byId = new Map(entries.map((e) => [e.sys.id, e]));

  const handler = (entity: string, method: string) => async (params: Record<string, unknown>, data?: unknown) => {
    calls.push({ method: `${entity}.${method}`, params, data });
    if (entity === 'entry' && method === 'getMany') {
      const query = params.query as { 'sys.id[in]': string };
      const ids = query['sys.id[in]'].split(',');
      return { items: ids.flatMap((id) => byId.get(id) ?? []) };
    }
    if (entity === 'editorInterface' && method === 'get') {
      return editorInterfaces.get(params.contentTypeId as string) ?? { sys: { version: 1 }, controls: [] };
    }
    if (method === 'get') return byId.get(params.entryId as string) ?? { sys: { id: 'x', version: 1 }, fields: {} };
    // Como Contentful: devuelve lo guardado con el mismo ID y la versión siguiente.
    const sys = (data as { sys?: { id?: string; version?: number } } | undefined)?.sys;
    return { ...(data as object), sys: { ...sys, id: sys?.id ?? 'x', version: (sys?.version ?? 0) + 1 } };
  };

  const cma = new Proxy(
    {},
    { get: (_, entity: string) => new Proxy({}, { get: (__, method: string) => handler(entity, method) }) },
  ) as Cma;
  return { cma, calls };
}

/** Lo que hay en un ambiente falso. Sin `locales`, el ambiente tiene solo es-CO. */
export interface FakeEnvironment {
  entries?: Entry[];
  assets?: Asset[];
  contentTypes?: ContentType[];
  locales?: string[];
  editors?: EditorInterface[];
  tags?: Tag[];
}

type Params = Record<string, unknown>;

/**
 * CMA falso con varios ambientes, sin red. Cada lectura devuelve lo que hay en su ambiente en ese
 * momento (si el test cambia un ambiente, la próxima lectura lo ve) y cada llamada queda en
 * `calls`. Las escrituras devuelven lo que recibieron con la versión siguiente, como Contentful.
 */
export function fakeContentful(environments: Record<string, FakeEnvironment>) {
  const calls: RecordedCall[] = [];
  const env = (params: Params): FakeEnvironment => environments[params.environmentId as string] ?? {};
  const byIds = <T extends { sys: { id: string } }>(items: T[] = [], params: Params) => {
    const ids = (params.query as { 'sys.id[in]'?: string } | undefined)?.['sys.id[in]']?.split(',');
    const found = ids ? items.filter((item) => ids.includes(item.sys.id)) : items;
    return { items: found, total: found.length };
  };
  const reads: Record<string, (params: Params) => unknown> = {
    'entry.getMany': (p) => byIds(env(p).entries, p),
    'entry.get': (p) => env(p).entries?.find((e) => e.sys.id === p.entryId),
    'asset.getMany': (p) => byIds(env(p).assets, p),
    'contentType.getMany': (p) => ({ items: env(p).contentTypes ?? [], total: env(p).contentTypes?.length ?? 0 }),
    'locale.getMany': (p) => ({
      items: (env(p).locales ?? ['es-CO']).map((code, i) => ({ code, default: i === 0, optional: false })),
    }),
    'tag.getMany': (p) => ({ items: env(p).tags ?? [] }),
    'editorInterface.getMany': (p) => ({ items: env(p).editors ?? [] }),
    'editorInterface.get': (p) =>
      env(p).editors?.find((e) => e.sys.contentType.sys.id === p.contentTypeId) ?? {
        sys: { version: 1 },
        controls: [],
      },
    'environment.getMany': () => ({
      items: Object.keys(environments).map((id) => ({ sys: { id, status: { sys: { id: 'ready' } } } })),
    }),
    'environmentAlias.getMany': () => ({ items: [] }),
  };

  const handler = (entity: string, method: string) => async (params: Params, data?: unknown) => {
    const key = `${entity}.${method}`;
    calls.push({ method: key, params, data });
    const read = reads[key];
    if (read) return read(params);
    const sys = (data as { sys?: { id?: string; version?: number } } | undefined)?.sys;
    const id = sys?.id ?? params.entryId ?? params.assetId ?? params.contentTypeId ?? params.tagId ?? 'x';
    return { ...(data as object), sys: { ...sys, id, version: (sys?.version ?? 0) + 1 } };
  };

  const cma = new Proxy(
    {},
    { get: (_, entity: string) => new Proxy({}, { get: (__, method: string) => handler(entity, method) }) },
  ) as Cma;
  /** Las llamadas que escriben (todo lo que no es una lectura). */
  const writes = () => calls.filter((c) => !reads[c.method]);
  const count = (method: string) => calls.filter((c) => c.method === method).length;
  return { cma, calls, writes, count };
}

/** La apariencia del editor de un content type, con un control por campo. */
export const editorOf = (ctId: string, fieldIds: string[]): EditorInterface =>
  ({
    sys: { version: 1, contentType: { sys: { id: ctId } } },
    controls: fieldIds.map((fieldId) => ({ fieldId, widgetId: 'singleLine', widgetNamespace: 'builtin' })),
  }) as unknown as EditorInterface;
