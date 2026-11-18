/**
 * Migrar imágenes y archivos sueltos, sin entries. Los que ya existen en destino se reutilizan;
 * los que faltan se crean en draft.
 *
 *   const review = await assetMigration(space, { src: 'develop', dst: 'qa' }).analyze(ids);
 *   if (!review.isEmpty) await review.execute({ backup, runner });
 */

import { fetchAssets } from '../contentful/read.ts';
import type { Asset, Envs, Locales } from '../contentful/types.ts';
import { createWriter } from '../contentful/write.ts';
import { applyAssets } from '../execute.ts';
import { noProgress, type Progress, perSpace, type WriteTools } from './shared.ts';

export interface AssetMigration extends Envs {
  /** Etapa 1 (solo lectura): qué archivos existen en cada ambiente. */
  analyze(ids: string[], onProgress?: Progress): Promise<AssetReview>;
}

/** Etapa 1: qué se reutiliza y qué se crea. Todavía no se escribió nada. */
export interface AssetReview extends Envs {
  assets: { ids: string[]; src: Map<string, Asset>; existing: Set<string>; missing: string[] };
  locales: { src: Locales; dst: Locales };
  /** Los que se crean en destino: existen en origen y faltan en destino. */
  toCreate: Asset[];
  /** No hay nada que copiar. */
  isEmpty: boolean;
  /** Etapa 2: crea en destino los que faltan (en draft). Devuelve lo que falló. */
  execute(tools: WriteTools): Promise<string[]>;
}

/** La migración de imágenes y archivos de un space, de `src` a `dst`. La misma para los mismos argumentos. */
export const assetMigration = perSpace(
  (space, envs): AssetMigration => ({
    ...envs,
    async analyze(ids, onProgress = noProgress) {
      onProgress('Revisando los archivos en ambos ambientes…');
      const [srcAssets, dstAssets, srcLocales, dstLocales] = await Promise.all([
        fetchAssets(space.cma, envs.src, ids),
        fetchAssets(space.cma, envs.dst, ids),
        space.locales(envs.src),
        space.locales(envs.dst),
      ]);
      const existing = new Set(dstAssets.keys());
      const missing = ids.filter((id) => !existing.has(id) && srcAssets.has(id));
      const toCreate = missing.flatMap((id) => srcAssets.get(id) ?? []);

      return {
        ...envs,
        assets: { ids, src: srcAssets, existing, missing },
        locales: { src: srcLocales, dst: dstLocales },
        toCreate,
        isEmpty: !toCreate.length,
        async execute(tools) {
          await applyAssets(toCreate, dstLocales, { ...tools, writer: createWriter(space.cma, envs) });
          return tools.runner.failures;
        },
      };
    },
  }),
);
