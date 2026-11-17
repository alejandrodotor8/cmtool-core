/** Límites de seguridad de la herramienta. */
export const LIMITS = {
  /** Si al leer el árbol se pasa de estas entries, se detiene: seguramente un link arrastra demasiado. */
  maxTreeEntries: 300,
  /** Si se van a escribir más entries que esto, pide confirmación antes de seguir. */
  confirmWritesAbove: 20,
  /** Resultados por búsqueda (una sola llamada): los más recientes primero. */
  searchResults: 50,
  /** "Las que faltan en destino": entries por página y máximo a recorrer en origen. */
  missingPageSize: 200,
  missingMaxEntries: 2000,
} as const;
