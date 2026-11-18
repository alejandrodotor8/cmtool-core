/**
 * Ejemplo: migrar una entry (con sus hijos) de develop a qa usando solo cmtool-core, sin terminal.
 * Es el mismo flujo de `cfm migrate`: analizar (solo lee) → planear (puro) → confirmar → escribir.
 * Lo revisa tsc junto con el resto del proyecto, así que no se queda viejo.
 */
import { type BackupData, connect, createBackup, createRecordingRunner, entryMigration } from 'cmtool-core';

export async function migrateEntry(token: string, spaceId: string, entryId: string): Promise<string[]> {
  const contentful = connect({ token }); // el token solo va a hosts de Contentful
  const space = contentful.space(spaceId);
  const migration = entryMigration(space, { src: 'develop', dst: 'qa' });

  // 1. Analizar (solo lectura): el árbol de la entry y qué ya existe en destino.
  const tree = await migration.analyze([entryId]);
  const review = await tree.review(tree.defaultUpdates()); // o las que elija la persona

  // 2. Planear (puro): aquí, con todos los cambios de modelo que hagan falta.
  const choices = await review.modelChoices();
  const plan = review.plan({ withAssets: true, picked: choices.all });
  if (plan.isEmpty) return [];

  // 3. Aquí la herramienta muestra el plan y pide confirmación. Nada se escribió todavía.
  //    Justo antes de escribir, se revisa que destino siga como estaba.
  const changed = await plan.changesInDestination();
  if (changed.length) throw new Error(`qa cambió mientras se revisaba el plan: ${changed.join(', ')}`);

  // 4. Escribir: el respaldo (dónde se guarda lo decides tú) y un runner sin pantalla.
  const saved: BackupData[] = [];
  const backup = createBackup(
    {
      kind: 'migrate',
      spaceId,
      src: migration.src,
      dst: migration.dst,
      rootIds: [entryId],
      account: await contentful.account(),
    },
    (data) => saved.push(structuredClone(data)), // en una web: guardarlo en tu base de datos
  );
  const runner = createRecordingRunner((phases) => console.log(phases.at(-1)));
  return plan.execute({ backup, runner });
}
