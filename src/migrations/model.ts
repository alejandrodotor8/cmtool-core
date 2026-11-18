/**
 * Migrar el modelo: llevar a destino lo que elijas de origen (content types y campos que faltan,
 * reglas de campos, nombre y descripción, apariencia del editor), sin tocar contenido. Nunca
 * borra campos ni cambia su ID o tipo.
 *
 *   const review = await modelMigration(space, { src: 'develop', dst: 'qa' }).analyze();
 *   const plan = review.plan(review.choices.all);   // o lo que elija la persona
 *   await plan.execute({ backup, runner });
 *
 * La etapa de análisis solo lee, así que también sirve para comparar modelos sin migrar nada.
 */
import type { ContentType, Envs } from '../contentful/types.ts';
import { createWriter } from '../contentful/write.ts';
import { editorDiffsFor } from '../core/editor.ts';
import { compareModels, type ModelComparison } from '../core/model.ts';
import {
  changesStructure,
  hasModelChanges,
  type ModelChanges,
  type ModelPick,
  modelChangesFrom,
  notAddedFields,
} from '../core/model-changes.ts';
import { type ModelChoices, modelChoices } from '../core/model-choices.ts';
import { AbortError } from '../errors.ts';
import { applyModelChanges } from '../execute.ts';
import { noProgress, type Progress, perSpace, type WriteTools } from './shared.ts';

export interface ModelMigration extends Envs {
  /** Etapa 1 (solo lectura): compara los modelos, de todos los content types o solo de `contentTypes`. */
  analyze(options?: { contentTypes?: string[] }, onProgress?: Progress): Promise<ModelReview>;
}

/** Etapa 1: la comparación de los dos modelos y lo que se puede llevar a destino. */
export interface ModelReview {
  models: { src: Map<string, ContentType>; dst: Map<string, ContentType> };
  /** Los content types de origen comparados con destino, y los que solo existen en destino. */
  comparison: ModelComparison;
  choices: ModelChoices;
  /** El modelo de destino ya tiene todo lo de origen, con la misma apariencia: no hay nada que elegir. */
  isUpToDate: boolean;
  /** Etapa 2 (pura): los cambios elegidos, listos para escribir. */
  plan(picked: ModelPick[]): ModelPlan;
}

/** Etapa 2: qué se va a cambiar en el modelo de destino. Todavía no se escribió nada. */
export interface ModelPlan {
  changes: ModelChanges;
  /** No se eligió nada: el modelo queda como está. */
  isEmpty: boolean;
  /** Crea content types o cambia campos: Contentful exige publicar el modelo para usarlos. */
  changesStructure: boolean;
  /** Campos que faltan en destino y no se eligieron (`contentType.campo`). */
  notAdded: string[];
  /** Etapa 3: escribe en el modelo de destino. Devuelve lo que falló. */
  execute(tools: WriteTools): Promise<string[]>;
}

/** La migración de modelo de un space, de `src` a `dst`. La misma para los mismos argumentos. */
export const modelMigration = perSpace(
  (space, envs): ModelMigration => ({
    ...envs,
    async analyze({ contentTypes } = {}, onProgress = noProgress) {
      onProgress('Leyendo modelos…');
      const [src, dst] = await Promise.all([space.contentTypes(envs.src), space.contentTypes(envs.dst)]);
      const unknown = (contentTypes ?? []).filter((id) => !src.has(id) && !dst.has(id));
      if (unknown.length) throw new AbortError(`Estos content types no existen: ${unknown.join(', ')}`);

      onProgress('Leyendo la apariencia del editor…');
      const [srcEditors, dstEditors] = await Promise.all([
        space.editorInterfaces(envs.src),
        space.editorInterfaces(envs.dst),
      ]);
      const comparison = compareModels(src, dst, contentTypes);
      const choices = modelChoices(comparison.diffs, {
        editorDiffs: editorDiffsFor(comparison.diffs, srcEditors, dstEditors),
      });

      return {
        models: { src, dst },
        comparison,
        choices,
        isUpToDate: !choices.options.length,
        plan(picked) {
          const changes = modelChangesFrom(picked, src);
          return {
            changes,
            isEmpty: !hasModelChanges(changes),
            changesStructure: changesStructure(changes),
            notAdded: notAddedFields(
              choices.options.map((o) => o.diff),
              changes.fieldsToAdd,
            ),
            async execute(tools) {
              const writer = createWriter(space.cma, envs);
              await applyModelChanges(changes, new Map(dst), () => space.editorInterfaces(envs.src), {
                ...tools,
                writer,
              });
              return tools.runner.failures;
            },
          };
        },
      };
    },
  }),
);
