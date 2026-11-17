/**
 * Una elección entre varias cosas, como se escribe en un flag (`--update`, `--model`):
 * todas, ninguna o una lista. Sirve para que el comando "Repetir" no vuelva a preguntar.
 * Funciones puras.
 */
export type Decision = 'all' | 'none' | string[];

/** Lee el valor de un flag: `all`, `none` o una lista separada por comas. */
export function parseDecision(value: string): Decision {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'all' || trimmed === 'none') return trimmed;
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Lo que se eligió, como decisión: `all` si fue todo, `none` si nada, si no, la lista. */
export function toDecision(available: string[], chosen: Iterable<string>): Decision {
  const picked = new Set(chosen);
  if (!picked.size) return 'none';
  if (available.length && available.every((key) => picked.has(key))) return 'all';
  return available.filter((key) => picked.has(key));
}

/** Aplica una decisión a lo que hay disponible. `unknown`: lo pedido que ya no está disponible. */
export function applyDecision(available: string[], decision: Decision): { chosen: string[]; unknown: string[] } {
  if (decision === 'all') return { chosen: available, unknown: [] };
  if (decision === 'none') return { chosen: [], unknown: [] };
  const wanted = new Set(decision);
  return {
    chosen: available.filter((key) => wanted.has(key)),
    unknown: decision.filter((key) => !available.includes(key)),
  };
}

/** Cómo se escribe una decisión en un flag. */
export const formatDecision = (decision: Decision): string =>
  typeof decision === 'string' ? decision : decision.join(',');
