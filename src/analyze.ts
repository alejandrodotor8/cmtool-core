/**
 * Análisis de "migrar entries", en dos etapas (solo lectura):
 *  1. analyzeTree: el árbol, qué existe en destino y qué cambió en origen;
 *  2. completeAnalysis: con lo que se decidió actualizar, el modelo, idiomas, imágenes y tags.
 */
import {
  fetchAssets,
  fetchEntries,
  readContentTypes,
  readEntryTree,
  readLocales,
  readTags,
} from './contentful/read.ts';
import type { Asset, Cma, ContentType, Entry, EntryTree, Locales, Tag } from './contentful/types.ts';
import { assetIdsOf, contentTypeOf, isArchived, makeTitleOf } from './core/entries.ts';
import { type FieldComparison, migrationChanges } from './core/entry-compare.ts';
import { type ContentTypeDiff, diffContentType } from './core/model.ts';
import { ACTION, type Action, changedInDst, classifyTree, writtenEntries } from './core/plan.ts';

/** Lo que se sabe del árbol antes de decidir qué actualizar. */
export interface TreeAnalysis {
  src: string;
  dst: string;
  rootIds: string[];
  tree: EntryTree;
  /** Las entries del árbol que ya existen en destino, tal como están allá. */
  dstEntries: Map<string, Entry>;
  existsInDst: Set<string>;
  /** Entries (del árbol o enlazadas en texto) que existen en destino pero están archivadas. */
  archivedInDst: Set<string>;
  /** Por cada entry que ya existe en destino, los campos que una migración cambiaría (vacío: sin cambios). */
  changes: Map<string, FieldComparison[]>;
  titleOf: (entry: Entry) => string;
}

export interface Analysis extends TreeAnalysis {
  /** Qué pasa con cada entry del árbol. */
  actions: Map<string, Action>;
  contentTypes: { src: Map<string, ContentType>; dst: Map<string, ContentType> };
  /** Comparación de modelo de cada content type del árbol. */
  diffs: Map<string, ContentTypeDiff>;
  locales: { src: Locales; dst: Locales; missing: string[] };
  /** Imágenes de las entries que se escriben. */
  assets: { ids: string[]; src: Map<string, Asset>; existing: Set<string>; missing: string[] };
  /** Tags de las entries que se escriben: los que ya hay en destino y los que faltan. */
  tags: { dstIds: Set<string>; missing: Tag[] };
}

/** Lee modelo e idiomas de un ambiente. */
export interface Loaders {
  contentTypes: (env: string) => Promise<Map<string, ContentType>>;
  locales: (env: string) => Promise<Locales>;
}

/** Avisa en qué etapa va (para el spinner). */
type Report = (stage: string) => void;

const defaultLoaders = (cma: Cma): Loaders => ({
  contentTypes: (env) => readContentTypes(cma, env),
  locales: (env) => readLocales(cma, env),
});

/** Etapa 1: el árbol y, de lo que ya existe en destino, qué cambió en origen. */
export async function analyzeTree(
  cma: Cma,
  { src, dst, rootIds }: { src: string; dst: string; rootIds: string[] },
  report: Report = () => {},
  load: Loaders = defaultLoaders(cma),
): Promise<TreeAnalysis> {
  report(`Leyendo las entries y sus hijos en ${src}…`);
  const tree = await readEntryTree(cma, src, rootIds);
  // También se revisan en destino las entries enlazadas en texto, para avisar si no existen.
  const hyperlinked = [...new Set([...tree.hyperlinks.values()].flat())].filter((id) => !tree.entries.has(id));
  report(`Buscando qué ya existe en ${dst}…`);
  const dstEntries = await fetchEntries(cma, dst, [...tree.entries.keys(), ...hyperlinked]);

  report(`Comparando con ${dst}…`);
  // Los modelos e idiomas quedan en memoria: la etapa 2 no los vuelve a pedir.
  const [srcCTs, dstCTs, srcLocales, dstLocales] = await Promise.all([
    load.contentTypes(src),
    load.contentTypes(dst),
    load.locales(src),
    load.locales(dst),
  ]);
  const changes = new Map<string, FieldComparison[]>();
  for (const [id, entry] of tree.entries) {
    const current = dstEntries.get(id);
    if (!current) continue;
    const ct = contentTypeOf(entry);
    const model = { srcCT: srcCTs.get(ct), dstCT: dstCTs.get(ct), locales: { src: srcLocales, dst: dstLocales } };
    changes.set(id, migrationChanges(entry, current, model));
  }

  return {
    src,
    dst,
    rootIds,
    tree,
    dstEntries,
    existsInDst: new Set(dstEntries.keys()),
    archivedInDst: new Set([...dstEntries.values()].filter(isArchived).map((e) => e.sys.id)),
    changes,
    titleOf: makeTitleOf(srcCTs, srcLocales.default),
  };
}

/** Las acciones del árbol con lo que se decidió actualizar (para mostrarlo antes de seguir). */
export const withActions = <T extends TreeAnalysis>(t: T, toUpdate: Set<string>) => ({
  ...t,
  actions: classifyTree(t.rootIds, t.tree, t.existsInDst, toUpdate),
});

/** Etapa 2: con lo que se decidió actualizar, el modelo, los idiomas, las imágenes y los tags. */
export async function completeAnalysis(
  cma: Cma,
  tree: TreeAnalysis,
  toUpdate: Set<string>,
  report: Report = () => {},
  load: Loaders = defaultLoaders(cma),
): Promise<Analysis> {
  const { src, dst } = tree;
  const { actions } = withActions(tree, toUpdate);
  const written = writtenEntries({ tree: tree.tree, actions });

  // Modelo: todos los content types del árbol, incluidos los de entries reutilizadas.
  report('Comparando modelos…');
  const contentTypes = { src: await load.contentTypes(src), dst: await load.contentTypes(dst) };
  const diffs = new Map<string, ContentTypeDiff>();
  for (const id of new Set([...tree.tree.entries.values()].map(contentTypeOf))) {
    const srcCT = contentTypes.src.get(id);
    if (!srcCT) throw new Error(`El content type "${id}" no existe en ${src}.`);
    diffs.set(id, diffContentType(srcCT, contentTypes.dst.get(id)));
  }

  report('Revisando idiomas, imágenes y tags…');
  const [srcLocales, dstLocales] = await Promise.all([load.locales(src), load.locales(dst)]);
  const locales = {
    src: srcLocales,
    dst: dstLocales,
    missing: [...srcLocales.codes].filter((code) => !dstLocales.codes.has(code)),
  };

  // Imágenes: solo las de entries que se escriben.
  const assetIds = [...new Set(written.flatMap(assetIdsOf))];
  const srcAssets = await fetchAssets(cma, src, assetIds);
  const existingAssets = new Set((await fetchAssets(cma, dst, assetIds)).keys());
  const assets = {
    ids: assetIds,
    src: srcAssets,
    existing: existingAssets,
    missing: assetIds.filter((id) => !existingAssets.has(id) && srcAssets.has(id)),
  };

  // Tags: solo los de entries que se escriben.
  const tagIds = [...new Set(written.flatMap((e) => (e.metadata?.tags ?? []).map((t) => t.sys.id)))];
  const tags: Analysis['tags'] = { dstIds: new Set(), missing: [] };
  if (tagIds.length) {
    tags.dstIds = new Set((await readTags(cma, dst)).keys());
    const missingIds = tagIds.filter((id) => !tags.dstIds.has(id));
    const srcTags = missingIds.length ? await readTags(cma, src) : new Map<string, Tag>();
    tags.missing = missingIds.flatMap((id) => srcTags.get(id) ?? []);
  }

  return { ...tree, actions, contentTypes, diffs, locales, assets, tags };
}

/**
 * Vuelve a mirar destino justo antes de escribir. Devuelve las entries del árbol que
 * aparecieron, desaparecieron o se archivaron mientras el usuario revisaba el plan, y las
 * que se van a actualizar y alguien editó en ese tiempo.
 */
export async function changesSinceAnalysis(cma: Cma, analysis: Analysis): Promise<string[]> {
  const ids = [...analysis.tree.entries.keys()];
  const now = await fetchEntries(cma, analysis.dst, ids);
  const updated = new Set(ids.filter((id) => analysis.actions.get(id) === ACTION.UPDATE));
  return changedInDst(ids, analysis.dstEntries, now, updated);
}
