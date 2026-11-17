/**
 * Cambios de modelo que elige el usuario, uno por uno: crear content types, agregar
 * campos, actualizar las reglas de un campo y copiar la apariencia del editor de un campo.
 * Lo usan "migrar entries" y "migrar modelo". Funciones puras.
 */
import type { ContentType, Field } from '../contentful/types.ts';
import type { EditorFieldDiff } from './editor.ts';
import { type ContentTypeDiff, type CtInfoChange, FIELD } from './model.ts';

export const CHANGE = {
  /** Crear el content type completo. */
  CREATE: 'create',
  /** Llevar a destino el nombre, la descripción y el campo de título del content type. */
  INFO: 'info',
  /** Agregar un campo que falta. */
  ADD: 'add',
  /** Llevar a destino las reglas del campo (nombre, obligatorio, localizado, validaciones). */
  RULES: 'rules',
  /** Copiar la apariencia del editor del campo (help text, widget). */
  EDITOR: 'editor',
} as const;

/** Un cambio que se puede marcar. */
export type ModelPick =
  | { kind: typeof CHANGE.CREATE; ctId: string }
  | { kind: typeof CHANGE.INFO; ctId: string; info: CtInfoChange[] }
  | { kind: typeof CHANGE.ADD; ctId: string; field: Field }
  | { kind: typeof CHANGE.RULES; ctId: string; field: Field }
  | { kind: typeof CHANGE.EDITOR; ctId: string; editor: EditorFieldDiff };

export interface ModelOption {
  diff: ContentTypeDiff;
  /** Solo lo usan entries reutilizadas: se agrega al modelo, pero su contenido no se copia. */
  onlyReused: boolean;
  /** Los cambios posibles de este content type, en el orden de sus campos. */
  picks: ModelPick[];
}

export interface ModelChanges {
  contentTypesToCreate: ContentType[];
  /** Content types (de origen) cuyo nombre, descripción y campo de título se llevan a destino. */
  infoToUpdate: Map<string, ContentType>;
  fieldsToAdd: Map<string, Field[]>;
  /** Campos (de origen) cuyas reglas se llevan a destino, por content type. */
  rulesToUpdate: Map<string, Field[]>;
  /**
   * Campos cuya apariencia se copia, por content type: siempre los de content types creados
   * y los campos agregados, más los que el usuario marcó.
   */
  editorFields: Map<string, Set<string>>;
}

/** Campos de cada content type con apariencia distinta en destino. */
export type EditorDiffs = Map<string, EditorFieldDiff[]>;

/** Los cambios posibles de un content type que existe en destino, en el orden de sus campos. */
function picksFor(diff: ContentTypeDiff, editorDiffs: EditorDiffs): ModelPick[] {
  const editorByField = new Map((editorDiffs.get(diff.id) ?? []).map((e) => [e.fieldId, e]));
  const info: ModelPick[] = diff.info.length ? [{ kind: CHANGE.INFO, ctId: diff.id, info: diff.info }] : [];
  const fields = diff.rows.flatMap((row): ModelPick[] => {
    const ctId = diff.id;
    const editor = editorByField.get(row.field.id);
    return [
      ...(row.status === FIELD.MISSING ? [{ kind: CHANGE.ADD, ctId, field: row.field } as const] : []),
      ...(row.status === FIELD.RULES ? [{ kind: CHANGE.RULES, ctId, field: row.field } as const] : []),
      ...(editor ? [{ kind: CHANGE.EDITOR, ctId, editor } as const] : []),
    ];
  });
  return [...info, ...fields];
}

/**
 * Lo que se puede cambiar en el modelo de destino, por content type: content types que no
 * existen, campos que faltan, reglas distintas y apariencia distinta. Con `written` (los
 * content types de las entries que se escriben), un content type que falta solo se ofrece
 * si alguna de esas entries lo usa.
 */
export function modelOptions(
  diffs: Iterable<ContentTypeDiff>,
  written?: Set<string>,
  editorDiffs: EditorDiffs = new Map(),
): ModelOption[] {
  return [...diffs]
    .filter((diff) => !diff.missingCT || !written || written.has(diff.id))
    .map((diff) => ({
      diff,
      onlyReused: written !== undefined && !written.has(diff.id),
      picks: diff.missingCT ? [{ kind: CHANGE.CREATE, ctId: diff.id } as const] : picksFor(diff, editorDiffs),
    }))
    .filter((option) => option.picks.length > 0);
}

/** Todos los cambios posibles. */
export const allPicks = (options: ModelOption[]): ModelPick[] => options.flatMap((o) => o.picks);

/**
 * Clave de un cambio para el flag `--model` (y el comando "Repetir"): `create:banner`,
 * `info:banner`, `add:banner.subtitle`, `rules:banner.title`, `editor:banner.title`.
 */
export function pickKey(pick: ModelPick): string {
  switch (pick.kind) {
    case CHANGE.CREATE:
    case CHANGE.INFO:
      return `${pick.kind}:${pick.ctId}`;
    case CHANGE.ADD:
    case CHANGE.RULES:
      return `${pick.kind}:${pick.ctId}.${pick.field.id}`;
    case CHANGE.EDITOR:
      return `${pick.kind}:${pick.ctId}.${pick.editor.fieldId}`;
  }
}

/** Convierte lo que marcó el usuario en cambios concretos. */
export function modelChangesFrom(picked: ModelPick[], srcCTs: Map<string, ContentType>): ModelChanges {
  const contentTypesToCreate: ContentType[] = [];
  const infoToUpdate = new Map<string, ContentType>();
  const fieldsToAdd = new Map<string, Field[]>();
  const rulesToUpdate = new Map<string, Field[]>();
  const editorFields = new Map<string, Set<string>>();
  const push = (map: Map<string, Field[]>, ctId: string, field: Field) =>
    map.set(ctId, [...(map.get(ctId) ?? []), field]);
  const copyEditor = (ctId: string, ids: string[]) => {
    if (ids.length) editorFields.set(ctId, new Set([...(editorFields.get(ctId) ?? []), ...ids]));
  };

  for (const pick of picked) {
    switch (pick.kind) {
      case CHANGE.CREATE: {
        const ct = srcCTs.get(pick.ctId);
        if (!ct) break;
        contentTypesToCreate.push(ct);
        copyEditor(
          ct.sys.id,
          ct.fields.map((f) => f.id),
        );
        break;
      }
      case CHANGE.INFO: {
        const ct = srcCTs.get(pick.ctId);
        if (ct) infoToUpdate.set(pick.ctId, ct);
        break;
      }
      case CHANGE.ADD:
        push(fieldsToAdd, pick.ctId, pick.field);
        copyEditor(pick.ctId, [pick.field.id]);
        break;
      case CHANGE.RULES:
        push(rulesToUpdate, pick.ctId, pick.field);
        break;
      case CHANGE.EDITOR:
        copyEditor(pick.ctId, [pick.editor.fieldId]);
        break;
    }
  }
  return { contentTypesToCreate, infoToUpdate, fieldsToAdd, rulesToUpdate, editorFields };
}

/** Campos que faltan en destino y no se marcaron (`contentType.campo`): su contenido no se migra. */
export function notAddedFields(diffs: Iterable<ContentTypeDiff>, fieldsToAdd: Map<string, Field[]>): string[] {
  return [...diffs].flatMap((d) =>
    d.missingCT
      ? []
      : d.missing.filter((f) => !fieldsToAdd.get(d.id)?.some((a) => a.id === f.id)).map((f) => `${d.id}.${f.id}`),
  );
}

const countIn = (map: Map<string, { length: number } | { size: number }>): number =>
  [...map.values()].reduce((n, list) => n + ('length' in list ? list.length : list.size), 0);

export const countNewFields = (changes: Pick<ModelChanges, 'fieldsToAdd'>): number => countIn(changes.fieldsToAdd);
export const countRuleFields = (changes: Pick<ModelChanges, 'rulesToUpdate'>): number => countIn(changes.rulesToUpdate);
export const countEditorFields = (changes: Pick<ModelChanges, 'editorFields'>): number => countIn(changes.editorFields);

/** Cambia la estructura del modelo (y por eso se publica). La apariencia sola no publica nada. */
export const changesStructure = (changes: ModelChanges): boolean =>
  changes.contentTypesToCreate.length +
    changes.infoToUpdate.size +
    changes.fieldsToAdd.size +
    changes.rulesToUpdate.size >
  0;

export const hasModelChanges = (changes: ModelChanges): boolean =>
  changesStructure(changes) || changes.editorFields.size > 0;
