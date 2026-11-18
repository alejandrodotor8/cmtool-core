/**
 * Deshacer una ejecución con su respaldo: las entries que se actualizaron vuelven exactamente a
 * como estaban (campos y tags guardados, sin mezclar). Lo que se creó no se borra, porque la
 * herramienta nunca borra. Las que alguien editó después, o que ya no existen, no se tocan.
 *
 *   const review = await backupRestore(space, data).analyze();
 *   if (!review.isEmpty) await review.execute({ backup, runner });   // el restore también se respalda
 */
import type { BackupData, SavedEntry } from '../backup.ts';
import type { SpaceConnection } from '../connection.ts';
import { fetchEntries } from '../contentful/read.ts';
import type { Entry } from '../contentful/types.ts';
import { createWriter } from '../contentful/write.ts';
import { type RestoreStatus, restoreStatus, shouldRestore } from '../core/restore.ts';
import { noProgress, type Progress, type WriteTools } from './shared.ts';

export interface BackupRestore {
  /** Etapa 1 (solo lectura): cómo están hoy, en destino, las entries del respaldo. */
  analyze(onProgress?: Progress): Promise<RestoreReview>;
}

/** Una entry del respaldo: cómo estaba, cómo está ahora y qué se hace con ella. */
export interface RestoreItem {
  saved: SavedEntry;
  current: Entry | undefined;
  status: RestoreStatus;
}

/** Etapa 1: qué se restaura. Todavía no se escribió nada. */
export interface RestoreReview {
  items: RestoreItem[];
  toRestore: SavedEntry[];
  /** No hay entries para restaurar. */
  isEmpty: boolean;
  /** Etapa 2: devuelve las entries a como estaban. Devuelve lo que falló. */
  execute(tools: WriteTools): Promise<string[]>;
}

/** El restore de un respaldo, en el space del respaldo (`space`). */
export function backupRestore(space: SpaceConnection, data: BackupData): BackupRestore {
  return {
    async analyze(onProgress = noProgress) {
      onProgress(`Revisando ${data.dst}…`);
      const now = await fetchEntries(
        space.cma,
        data.dst,
        data.updated.map((e) => e.id),
      );
      const items = data.updated.map((saved) => {
        const current = now.get(saved.id);
        return { saved, current, status: restoreStatus(saved, current) };
      });
      const toRestore = items.filter((item) => shouldRestore(item.status)).map((item) => item.saved);

      return {
        items,
        toRestore,
        isEmpty: !toRestore.length,
        async execute({ backup, runner }) {
          const writer = createWriter(space.cma, data);
          runner.start('Restaurando', toRestore.length);
          for (const saved of toRestore) {
            await runner.run(`${saved.title} · ${saved.id}`, async () => {
              await writer.updateEntry(
                saved.id,
                () => ({ fields: saved.fields, tags: saved.tags }),
                (entry) => backup.recordUpdate(entry, saved.title),
              );
              backup.confirmUpdate(saved.id);
            });
          }
          runner.end();
          return runner.failures;
        },
      };
    },
  };
}
