/**
 * Respaldo de una ejecución, para poder deshacerla: cómo estaba cada entry antes de actualizarla
 * y qué se creó. El núcleo arma el respaldo y llama a `save` en cada cambio (para que quede
 * completo aunque el proceso se corte a la mitad); dónde se guarda lo decide quien lo usa.
 * En Node, `startBackup` de cmtool-core/node lo guarda en archivos.
 */
import type { Account, ContentType, Entry, Field, TagLink } from './contentful/types.ts';
import { contentTypeOf } from './core/entries.ts';

/** Cómo estaba una entry en destino justo antes de actualizarla. */
export interface SavedEntry {
  id: string;
  contentType: string;
  title: string;
  /** `sys.version` antes de actualizar; la actualización la deja en version + 1. */
  version: number;
  fields: Entry['fields'];
  tags: TagLink[];
  /** Se guarda en `false` antes de actualizar y pasa a `true` cuando la actualización funcionó. */
  applied: boolean;
}

export interface BackupData {
  version: 1;
  /** Qué comando lo creó: migrar entries, modelo o imágenes, o un restore. */
  kind: 'migrate' | 'model' | 'assets' | 'restore';
  createdAt: string;
  /** Cuenta que hizo la ejecución. Falta en los respaldos anteriores a la versión 0.6.0. */
  account?: Account;
  spaceId: string;
  src: string;
  dst: string;
  rootIds: string[];
  updated: SavedEntry[];
  /** Lo que se creó. `restore` no lo borra: solo lo lista. */
  created: { entries: string[]; assets: string[]; contentTypes: string[]; tags: string[] };
  /** Campos agregados al modelo, por content type. */
  fieldsAdded: Record<string, string[]>;
  /** Campos cuya apariencia del editor se cambió, por content type (falta en respaldos anteriores). */
  editorUpdated?: Record<string, string[]>;
  /** Cómo estaban los campos cuyas reglas se cambiaron, por content type (para revertirlo a mano). */
  rulesUpdated?: Record<string, Field[]>;
  /** Cómo estaban el nombre, la descripción y el campo de título de los content types que se cambiaron. */
  infoUpdated?: Record<string, ContentTypeInfo>;
}

export type CreatedKind = keyof BackupData['created'];
export type ContentTypeInfo = Pick<ContentType, 'name' | 'description' | 'displayField'>;
export type Backup = ReturnType<typeof createBackup>;

/** Dónde se guarda el respaldo: se llama con el respaldo completo en cada cambio. */
export type SaveBackup = (data: BackupData) => void;

/** Empieza un respaldo y lo guarda de una vez. Cada `record…` lo vuelve a guardar. */
export function createBackup(
  meta: Pick<BackupData, 'kind' | 'spaceId' | 'src' | 'dst' | 'rootIds'> & { account: Account },
  save: SaveBackup,
  createdAt = new Date().toISOString(),
) {
  const data: BackupData = {
    version: 1,
    createdAt,
    ...meta,
    updated: [],
    created: { entries: [], assets: [], contentTypes: [], tags: [] },
    fieldsAdded: {},
  };
  const persist = () => save(data);
  persist();

  return {
    data,
    recordUpdate(entry: Entry, title: string) {
      data.updated.push({
        id: entry.sys.id,
        contentType: contentTypeOf(entry),
        title,
        version: entry.sys.version,
        fields: entry.fields ?? {},
        tags: entry.metadata?.tags ?? [],
        applied: false,
      });
      persist();
    },
    /** La actualización de esa entry sí se hizo. */
    confirmUpdate(id: string) {
      const saved = data.updated.findLast((e) => e.id === id);
      if (saved) saved.applied = true;
      persist();
    },
    recordCreated(kind: CreatedKind, id: string) {
      data.created[kind].push(id);
      persist();
    },
    recordFields(ctId: string, fieldIds: string[]) {
      data.fieldsAdded[ctId] = [...(data.fieldsAdded[ctId] ?? []), ...fieldIds];
      persist();
    },
    /** Guarda cómo estaban el nombre, la descripción y el campo de título antes de cambiarlos. */
    recordInfo(ctId: string, { name, description, displayField }: ContentTypeInfo) {
      data.infoUpdated = { ...data.infoUpdated, [ctId]: { name, description, displayField } };
      persist();
    },
    /** Guarda cómo estaban los campos antes de cambiar sus reglas. */
    recordRules(ctId: string, previous: Field[]) {
      data.rulesUpdated = { ...data.rulesUpdated, [ctId]: [...(data.rulesUpdated?.[ctId] ?? []), ...previous] };
      persist();
    },
    recordEditor(ctId: string, fieldIds: string[]) {
      data.editorUpdated = { ...data.editorUpdated, [ctId]: [...(data.editorUpdated?.[ctId] ?? []), ...fieldIds] };
      persist();
    },
  };
}

/** Si un JSON es un respaldo que se puede usar. */
export const isBackup = (data: unknown): data is BackupData =>
  (data as BackupData)?.version === 1 && Array.isArray((data as BackupData).updated);
