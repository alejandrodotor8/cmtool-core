import type { ContentType, Entry } from '../contentful/types.ts';

export interface LinkRef {
  type: 'Entry' | 'Asset';
  id: string;
  /** Es un texto enlazado dentro de un rich text (hipervínculo), no un componente. */
  hyperlink: boolean;
}

/** Nodos de rich text que son texto enlazado, no contenido embebido. */
const HYPERLINK_NODES = new Set(['entry-hyperlink', 'asset-hyperlink']);

/** Recorre cualquier valor (campos, arrays, rich text) y devuelve los links a Entry o Asset. */
export function collectLinks(value: unknown, out: LinkRef[] = [], hyperlink = false): LinkRef[] {
  if (Array.isArray(value)) {
    for (const v of value) collectLinks(v, out, hyperlink);
  } else if (value && typeof value === 'object') {
    const node = value as { nodeType?: string; sys?: { type?: string; linkType?: string; id?: string } };
    const sys = node.sys;
    if (sys?.type === 'Link' && (sys.linkType === 'Entry' || sys.linkType === 'Asset') && sys.id) {
      out.push({ type: sys.linkType, id: sys.id, hyperlink });
    } else {
      const inHyperlink = hyperlink || HYPERLINK_NODES.has(node.nodeType ?? '');
      for (const v of Object.values(value)) collectLinks(v, out, inHyperlink);
    }
  }
  return out;
}

const linkedIds = (entry: Entry, keep: (link: LinkRef) => boolean): string[] => [
  ...new Set(
    collectLinks(entry.fields)
      .filter(keep)
      .map((l) => l.id),
  ),
];

/** IDs de las entries que la componen (sus hijos). Un texto enlazado no es un hijo. */
export const childEntryIds = (entry: Entry): string[] => linkedIds(entry, (l) => l.type === 'Entry' && !l.hyperlink);

/** IDs de entries a las que solo apunta un texto enlazado en un rich text (no son hijos, no se migran). */
export const hyperlinkedEntryIds = (entry: Entry): string[] => {
  const children = new Set(childEntryIds(entry));
  return linkedIds(entry, (l) => l.type === 'Entry' && l.hyperlink).filter((id) => !children.has(id));
};

/** IDs de las imágenes y archivos que usa (incluidos los enlazados en texto). */
export const assetIdsOf = (entry: Entry): string[] => linkedIds(entry, (l) => l.type === 'Asset');

/** La entry está archivada: no se puede actualizar ni publicar un link hacia ella. */
export const isArchived = (entry: Entry): boolean => Boolean(entry.sys.archivedVersion ?? entry.sys.archivedAt);

export const contentTypeOf = (entry: Entry): string => entry.sys.contentType.sys.id;

/** Título legible de una entry según el displayField de su content type. */
export const makeTitleOf =
  (contentTypes: Map<string, ContentType>, locale: string | undefined) =>
  (entry: Entry): string => {
    const displayField = contentTypes.get(contentTypeOf(entry))?.displayField;
    const value: Record<string, unknown> | undefined = displayField ? entry.fields?.[displayField] : undefined;
    const title = (locale ? value?.[locale] : undefined) ?? (value && Object.values(value)[0]);
    return typeof title === 'string' ? title : '(sin título)';
  };
