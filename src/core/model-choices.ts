/**
 * Los cambios de modelo que se pueden elegir, con lo necesario para preguntarlos, recibirlos por
 * flag (`--model`) y escribir el comando que los repite. Funciones puras.
 */
import { applyDecision, type Decision, toDecision } from './decision.ts';
import type { ContentTypeDiff } from './model.ts';
import {
  allPicks,
  type EditorDiffs,
  type ModelOption,
  type ModelPick,
  modelOptions,
  pickKey,
} from './model-changes.ts';

export interface ModelChoices {
  /** Por content type, los cambios que se le pueden aplicar (para preguntarlos). */
  options: ModelOption[];
  /** Por content type, los campos que tienen otra apariencia del editor en destino. */
  editorDiffs: EditorDiffs;
  /** Todos los cambios que se pueden elegir. */
  all: ModelPick[];
  /** Cómo se escribe una elección en el flag `--model` (para el comando "Repetir"). */
  decisionFor(picked: ModelPick[]): Decision;
  /** Lo que elige una decisión del flag `--model`. `unknown`: lo pedido que ya no está disponible. */
  apply(decision: Decision): { picked: ModelPick[]; unknown: string[] };
}

/**
 * Los cambios que se pueden elegir a partir de la comparación de modelos. Con `written` (los
 * content types de lo que se escribe), un content type que falta en destino solo se ofrece si
 * hace falta para escribir.
 */
export function modelChoices(
  diffs: Iterable<ContentTypeDiff>,
  { written, editorDiffs = new Map() }: { written?: Set<string>; editorDiffs?: EditorDiffs } = {},
): ModelChoices {
  const options = modelOptions(diffs, written, editorDiffs);
  const all = allPicks(options);
  const keys = all.map(pickKey);
  return {
    options,
    editorDiffs,
    all,
    decisionFor: (picked) => toDecision(keys, picked.map(pickKey)),
    apply(decision) {
      const { chosen, unknown } = applyDecision(keys, decision);
      const wanted = new Set(chosen);
      return { picked: all.filter((pick) => wanted.has(pickKey(pick))), unknown };
    },
  };
}
