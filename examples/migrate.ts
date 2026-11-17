/**
 * Ejemplo: migrar una entry (con sus hijos) de develop a qa usando solo cmtool-core, sin terminal.
 * Es el mismo flujo de `cfm migrate`: analizar (solo lee) → planear (puro) → confirmar → escribir.
 * Lo revisa tsc junto con el resto del proyecto, así que no se queda viejo.
 */
import {
  allPicks,
  analyzeTree,
  type BackupData,
  buildPlan,
  completeAnalysis,
  createBackup,
  createCma,
  createRecordingRunner,
  createWriter,
  currentUser,
  defaultUpdates,
  executePlan,
  modelOptions,
  readEditorInterfaces,
  updateCandidates,
  writtenContentTypes,
} from 'cmtool-core';

export async function migrateEntry(token: string, spaceId: string, entryId: string): Promise<string[]> {
  const cma = createCma({ token }, spaceId); // solo acepta hosts de Contentful
  const envs = { src: 'develop', dst: 'qa' };

  // 1. Analizar (solo lectura): el árbol de la entry y qué ya existe en destino.
  const tree = await analyzeTree(cma, { ...envs, rootIds: [entryId] });
  const toUpdate = defaultUpdates(updateCandidates(tree)); // o las que elija la persona
  const analysis = await completeAnalysis(cma, tree, toUpdate);

  // 2. Planear (puro): qué cambios de modelo aplicar (aquí, todos los que hagan falta) y qué escribir.
  const options = modelOptions(analysis.diffs.values(), writtenContentTypes(analysis));
  const plan = buildPlan(analysis, { withAssets: true, picked: allPicks(options) });

  // 3. Aquí la herramienta muestra el plan y pide confirmación. Nada se escribió todavía.

  // 4. Escribir: respaldo (dónde se guarda lo decides tú), writer atado al destino y runner sin pantalla.
  const user = await currentUser(cma);
  const saved: BackupData[] = [];
  const backup = createBackup(
    {
      kind: 'migrate',
      spaceId,
      ...envs,
      rootIds: [entryId],
      account: { userId: user.id, email: user.email, host: 'api.contentful.com' },
    },
    (data) => saved.push(structuredClone(data)), // en una web: guardarlo en tu base de datos
  );
  const runner = createRecordingRunner((phases) => console.log(phases.at(-1)));
  const writer = createWriter(cma, envs);
  return executePlan(plan, analysis, () => readEditorInterfaces(cma, envs.src), { writer, backup, runner });
}
