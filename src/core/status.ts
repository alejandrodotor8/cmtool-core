/**
 * Estado de dos ambientes: en qué se diferencian modelo, idiomas y tags. Funciones puras.
 */
import type { Locales } from '../contentful/types.ts';
import { type ContentTypeDiff, hasDifferences, type ModelComparison } from './model.ts';

export interface EnvironmentStatus {
  contentTypes: {
    same: ContentTypeDiff[];
    different: ContentTypeDiff[];
    /** Existen en origen y no en destino. */
    missingInDst: ContentTypeDiff[];
    onlyInDst: string[];
  };
  locales: { missingInDst: string[]; onlyInDst: string[] };
  tags: { missingInDst: string[]; onlyInDst: string[] };
}

const minus = (a: Iterable<string>, b: Set<string>) => [...a].filter((x) => !b.has(x)).sort();

export function environmentStatus(
  model: ModelComparison,
  locales: { src: Locales; dst: Locales },
  tags: { src: Set<string>; dst: Set<string> },
): EnvironmentStatus {
  return {
    contentTypes: {
      same: model.diffs.filter((d) => !hasDifferences(d)),
      different: model.diffs.filter((d) => !d.missingCT && hasDifferences(d)),
      missingInDst: model.diffs.filter((d) => d.missingCT),
      onlyInDst: model.onlyInDst.map((ct) => ct.sys.id),
    },
    locales: {
      missingInDst: minus(locales.src.codes, locales.dst.codes),
      onlyInDst: minus(locales.dst.codes, locales.src.codes),
    },
    tags: { missingInDst: minus(tags.src, tags.dst), onlyInDst: minus(tags.dst, tags.src) },
  };
}
