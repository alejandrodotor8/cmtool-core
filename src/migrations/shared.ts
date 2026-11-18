/**
 * Lo que comparten las migraciones: el aviso de avance, con qué se escribe, y que la misma
 * migración (mismo space, origen y destino) sea siempre el mismo objeto, con lo que ya leyó.
 */
import type { Backup } from '../backup.ts';
import type { SpaceConnection } from '../connection.ts';
import type { Envs } from '../contentful/types.ts';
import { AbortError } from '../errors.ts';
import type { Runner } from '../runner.ts';

/** Avisa en qué va una lectura larga, para mostrarlo (un spinner, una barra). */
export type Progress = (message: string) => void;

export const noProgress: Progress = () => {};

/**
 * Con qué se escribe: el respaldo (dónde se guarda lo decide quien lo usa) y el runner (cómo se
 * muestra el avance). El writer no va aquí: lo arma cada migración, atado a su destino.
 */
export interface WriteTools {
  backup: Backup;
  runner: Runner;
}

/**
 * Envuelve lo que crea una migración para que, con el mismo space, origen y destino, devuelva
 * siempre el mismo objeto: así lo que ya leyó no se vuelve a leer al volver atrás.
 */
export function perSpace<T>(
  create: (space: SpaceConnection, envs: Envs) => T,
): (space: SpaceConnection, envs: Envs) => T {
  const bySpace = new WeakMap<SpaceConnection, Map<string, T>>();
  return (space, { src, dst }) => {
    if (src === dst) throw new AbortError('Origen y destino son el mismo ambiente.');
    const byEnvs = bySpace.get(space) ?? new Map<string, T>();
    bySpace.set(space, byEnvs);
    const key = `${src}\n${dst}`;
    const migration = byEnvs.get(key) ?? create(space, { src, dst });
    byEnvs.set(key, migration);
    return migration;
  };
}
