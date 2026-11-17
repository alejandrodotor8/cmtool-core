import type { Environment } from '../contentful/types.ts';

/** ID del ambiente que corresponde a un nombre: su ID o uno de sus aliases (`master`). */
export function resolveEnvironment(envs: Environment[], name: string): string | undefined {
  return envs.find((e) => e.id === name)?.id ?? envs.find((e) => e.aliases.includes(name))?.id;
}

/** Parece producción: es `master` o tiene un alias (en Contentful, el alias `master` apunta a producción). */
export const looksLikeProduction = (env: Environment): boolean => env.id === 'master' || env.aliases.length > 0;

/** Orden de un ambiente: desarrollo, pruebas, otros y producción al final. */
function environmentRank(env: Environment): number {
  if (looksLikeProduction(env)) return 3;
  if (/^dev/i.test(env.id)) return 0;
  if (/qa|test|stag|uat|pre/i.test(env.id)) return 1;
  return 2;
}

/** Los ambientes de desarrollo primero (develop, QA…) y producción al final; dentro de cada grupo, por nombre. */
export const sortEnvironments = (envs: Environment[]): Environment[] =>
  [...envs].sort((a, b) => environmentRank(a) - environmentRank(b) || a.id.localeCompare(b.id));
