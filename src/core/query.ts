/**
 * Búsqueda de entries: los filtros se resuelven en el servidor de Contentful, así cada
 * búsqueda es una sola llamada. Funciones puras.
 */

/** Filtros combinables para buscar entries en origen. */
export interface EntryQuery {
  /** Texto libre (busca en todos los campos de texto). */
  text?: string;
  contentTypes?: string[];
  tag?: string;
  /** Fecha ISO: entries actualizadas desde ese momento. */
  since?: string;
  /** ID del usuario que hizo la última actualización ("solo las mías"). */
  updatedBy?: string;
}

export const isEmptyQuery = (q: EntryQuery): boolean =>
  !q.text && !q.contentTypes?.length && !q.tag && !q.since && !q.updatedBy;

/** Parámetros del CMA para la búsqueda: las más recientes primero, sin archivadas. */
export function entryQueryParams(q: EntryQuery, limit: number): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = {
    limit,
    order: '-sys.updatedAt',
    'sys.archivedAt[exists]': false,
  };
  if (q.text) params.query = q.text;
  // `content_type` acepta uno solo; para varios se filtra por el ID del content type.
  if (q.contentTypes?.length === 1) params.content_type = q.contentTypes[0] as string;
  else if (q.contentTypes?.length) params['sys.contentType.sys.id[in]'] = q.contentTypes.join(',');
  if (q.tag) params['metadata.tags.sys.id[in]'] = q.tag;
  if (q.since) params['sys.updatedAt[gte]'] = q.since;
  if (q.updatedBy) params['sys.updatedBy.sys.id'] = q.updatedBy;
  return params;
}

/**
 * Entiende `hoy`, `7d` (últimos N días) o una fecha `AAAA-MM-DD`, y devuelve la fecha ISO
 * desde la que buscar. `undefined` si no se entiende.
 */
export function parseSince(text: string, now = new Date()): string | undefined {
  const value = text.trim().toLowerCase();
  if (value === 'hoy') {
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    return today.toISOString();
  }
  const days = /^(\d{1,4})d$/.exec(value);
  if (days) return new Date(now.getTime() - Number(days[1]) * 86_400_000).toISOString();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymd) {
    const [year, month, day] = ymd.slice(1).map(Number) as [number, number, number];
    const date = new Date(year, month - 1, day);
    // Rechaza fechas imposibles (2026-02-30 se convertiría en otra fecha).
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day)
      return date.toISOString();
  }
  return undefined;
}
