/**
 * Migrar entries (cada una con sus hijos) de un ambiente a otro, por etapas. Cada etapa devuelve
 * la siguiente, así que el orden no se puede saltar:
 *
 *   const migration = entryMigration(space, { src: 'develop', dst: 'qa' });
 *   const tree = await migration.analyze([entryId]);          // 1. el árbol (solo lee)
 *   const review = await tree.review(tree.defaultUpdates());  // 2. modelo, imágenes y tags (solo lee)
 *   const choices = await review.modelChoices();
 *   const plan = review.plan({ withAssets: true, picked: choices.all }); // 3. qué se escribe (puro)
 *   // aquí tu herramienta muestra el plan y pide confirmación
 *   if ((await plan.changesInDestination()).length) …        // destino cambió: no escribas
 *   await plan.execute({ backup, runner });                   // 4. escribir
 *
 * Volver a una etapa anterior no repite lecturas: `analyze` y `review` guardan su resultado para
 * los mismos argumentos.
 */
import {
  type Analysis,
  analyzeTree,
  changesSinceAnalysis,
  completeAnalysis,
  type TreeAnalysis,
  withActions,
} from '../analyze.ts';
import type { SpaceConnection } from '../connection.ts';
import type { Entry, Envs } from '../contentful/types.ts';
import { createWriter } from '../contentful/write.ts';
import { cache } from '../core/cache.ts';
import { applyDecision, type Decision, toDecision } from '../core/decision.ts';
import { editorDiffsFor } from '../core/editor.ts';
import { contentTypeOf } from '../core/entries.ts';
import { hasModelChanges, type ModelPick } from '../core/model-changes.ts';
import { type ModelChoices, modelChoices } from '../core/model-choices.ts';
import {
  type Action,
  brokenHyperlinks,
  buildPlan,
  defaultUpdates,
  isWrite,
  type Plan,
  type UpdateCandidate,
  updateCandidates,
  writtenContentTypes,
} from '../core/plan.ts';
import { type RequiredGap, requiredGaps } from '../core/publish-check.ts';
import { executePlan } from '../execute.ts';
import { noProgress, type Progress, perSpace, type WriteTools } from './shared.ts';

export interface EntryMigration extends Envs {
  /** Etapa 1 (solo lectura): el árbol de las entries y, de lo que ya existe en destino, qué cambió. */
  analyze(rootIds: string[], onProgress?: Progress): Promise<MigrationTree>;
}

/** Etapa 1: el árbol, antes de decidir qué actualizar de lo que ya existe en destino. */
export interface MigrationTree {
  analysis: TreeAnalysis;
  /** Entries que ya existen en destino y cambiaron en origen: se pueden actualizar. */
  candidates: UpdateCandidate[];
  /** Lo que se actualiza si nadie elige: las entries elegidas que cambiaron (los hijos, no). */
  defaultUpdates(): Set<string>;
  /** Qué pasaría con cada entry si se actualiza `toUpdate` (para mostrarlo antes de seguir). */
  preview(toUpdate: Set<string>): TreeAnalysis & { actions: Map<string, Action> };
  /** Cuántas entries se escribirían (crear o actualizar) con `toUpdate`. */
  writes(toUpdate: Set<string>): number;
  /** Cómo se escribe `toUpdate` en el flag `--update` (para "Repetir"). Sin candidatos, `undefined`. */
  updateDecision(toUpdate: Set<string>): Decision | undefined;
  /** Lo que elige una decisión del flag `--update`. `unknown`: lo pedido que ya no está disponible. */
  applyUpdateDecision(decision: Decision): { chosen: Set<string>; unknown: string[] };
  /** Etapa 2 (solo lectura): con lo que se actualiza, el modelo, los idiomas, las imágenes y los tags. */
  review(toUpdate: Set<string>, onProgress?: Progress): Promise<MigrationReview>;
}

/** Etapa 2: todo lo que hace falta para decidir el modelo y armar el plan. */
export interface MigrationReview {
  analysis: Analysis;
  /** Las entries del árbol de un content type, con su título y si se escriben (o se reutilizan). */
  entriesOf(contentTypeId: string): { entry: Entry; title: string; written: boolean }[];
  /** Los cambios de modelo que hacen falta para lo que se escribe (lee la apariencia del editor). */
  modelChoices(): Promise<ModelChoices>;
  /** Etapa 3 (pura): qué se escribe, con las imágenes que faltan o sin ellas, y los cambios de modelo elegidos. */
  plan(options: { withAssets: boolean; picked: ModelPick[] }): MigrationPlan;
}

/** Etapa 3: qué se va a escribir. Todavía no se escribió nada. */
export interface MigrationPlan {
  plan: Plan;
  /** No hay nada que crear ni actualizar: ni entries, ni modelo, ni tags. */
  isEmpty: boolean;
  /** Por entry, los campos obligatorios que quedarán vacíos (no se podrá publicar así). */
  gaps: Map<string, RequiredGap[]>;
  /** Por entry, los textos enlazados que apuntarán a entries que no existen en destino. */
  brokenHyperlinks: Map<string, string[]>;
  /** Vuelve a mirar destino: las entries que cambiaron desde el análisis. Si hay alguna, no escribas. */
  changesInDestination(): Promise<string[]>;
  /** Etapa 4: escribe en destino (entries e imágenes quedan en draft). Devuelve lo que falló. */
  execute(tools: WriteTools): Promise<string[]>;
}

/** La migración de entries de un space, de `src` a `dst`. La misma para los mismos argumentos. */
export const entryMigration = perSpace((space, envs): EntryMigration => {
  const trees = cache<MigrationTree>();
  return {
    ...envs,
    analyze: (rootIds, onProgress = noProgress) =>
      trees(rootIds.join(','), async () =>
        migrationTree(space, await analyzeTree(space.cma, { ...envs, rootIds }, onProgress, space)),
      ),
  };
});

function migrationTree(space: SpaceConnection, tree: TreeAnalysis): MigrationTree {
  const candidates = updateCandidates(tree);
  const candidateIds = candidates.map((c) => c.id);
  const reviews = cache<MigrationReview>();
  const preview = (toUpdate: Set<string>) => withActions(tree, toUpdate);

  return {
    analysis: tree,
    candidates,
    defaultUpdates: () => defaultUpdates(candidates),
    preview,
    writes: (toUpdate) => [...preview(toUpdate).actions.values()].filter(isWrite).length,
    updateDecision: (toUpdate) => (candidates.length ? toDecision(candidateIds, toUpdate) : undefined),
    applyUpdateDecision(decision) {
      const { chosen, unknown } = applyDecision(candidateIds, decision);
      return { chosen: new Set(chosen), unknown };
    },
    review: (toUpdate, onProgress = noProgress) =>
      reviews([...toUpdate].sort().join(','), async () =>
        migrationReview(space, await completeAnalysis(space.cma, tree, toUpdate, onProgress, space)),
      ),
  };
}

function migrationReview(space: SpaceConnection, analysis: Analysis): MigrationReview {
  const { src, dst } = analysis;
  return {
    analysis,
    entriesOf: (contentTypeId) =>
      [...analysis.tree.entries.values()]
        .filter((entry) => contentTypeOf(entry) === contentTypeId)
        .map((entry) => ({
          entry,
          title: analysis.titleOf(entry),
          written: isWrite(analysis.actions.get(entry.sys.id)),
        })),
    async modelChoices() {
      const [srcEditors, dstEditors] = await Promise.all([space.editorInterfaces(src), space.editorInterfaces(dst)]);
      const diffs = [...analysis.diffs.values()];
      return modelChoices(diffs, {
        written: writtenContentTypes(analysis),
        editorDiffs: editorDiffsFor(diffs, srcEditors, dstEditors),
      });
    },
    plan: (options) => migrationPlan(space, analysis, buildPlan(analysis, options)),
  };
}

function migrationPlan(space: SpaceConnection, analysis: Analysis, plan: Plan): MigrationPlan {
  const { src, dst } = analysis;
  return {
    plan,
    isEmpty: !plan.entries.length && !hasModelChanges(plan) && !plan.tagsToCreate.length,
    gaps: requiredGaps(analysis, plan),
    brokenHyperlinks: brokenHyperlinks(analysis),
    changesInDestination: () => changesSinceAnalysis(space.cma, analysis),
    execute: (tools) =>
      executePlan(plan, analysis, () => space.editorInterfaces(src), {
        ...tools,
        writer: createWriter(space.cma, { src, dst }),
      }),
  };
}
