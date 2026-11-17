/**
 * JSON para comparar valores sin que cuente el orden de las claves de un objeto: el mismo
 * contenido puede venir con las claves en otro orden según el ambiente o quién lo guardó
 * (idiomas de un campo, nodos de un rich text, ajustes de una validación).
 */
function canonical(value: unknown, sortLists: boolean): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v, sortLists));
    return sortLists && items.every((x) => typeof x !== 'object' || x === null) ? [...items].sort() : items;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((key) => [key, canonical(obj[key], sortLists)]),
    );
  }
  return value;
}

/**
 * Para reglas del modelo: además, las listas de valores simples se ordenan, así el orden
 * no cuenta como diferencia (por ejemplo, en validaciones `in: ['a', 'b']`).
 */
export const stableJson = (value: unknown): string => JSON.stringify(canonical(value, true));

/** Para contenido: el orden de las listas sí importa (links, párrafos de un rich text). */
export const exactJson = (value: unknown): string => JSON.stringify(canonical(value, false));
