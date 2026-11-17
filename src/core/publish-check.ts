/**
 * Qué entries no se podrán publicar en destino después de migrar, por campos
 * obligatorios que quedan vacíos. Funciones puras: miran el plan, no Contentful.
 */
import type { Analysis } from '../analyze.ts';
import type { ContentType, Entry, Field } from '../contentful/types.ts';
import { contentTypeOf } from './entries.ts';
import { fieldsForDestination, mergeWithExisting, writableFields } from './fields.ts';
import { rulesFrom } from './model.ts';
import { ACTION, type Plan } from './plan.ts';

/** Cómo quedará el content type en destino después de aplicar los cambios de modelo del plan. */
export function projectedContentType(ctId: string, analysis: Analysis, plan: Plan): ContentType | undefined {
  if (plan.contentTypesToCreate.some((ct) => ct.sys.id === ctId)) return analysis.contentTypes.src.get(ctId);
  const dstCT = analysis.contentTypes.dst.get(ctId);
  if (!dstCT) return undefined;
  const withRules = rulesFrom(plan.rulesToUpdate.get(ctId) ?? []);
  return { ...dstCT, fields: [...dstCT.fields.map(withRules), ...(plan.fieldsToAdd.get(ctId) ?? [])] };
}

const isBlank = (value: unknown): boolean =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);

/** Un campo obligatorio que quedará vacío, y en qué locales. */
export interface RequiredGap {
  field: Field;
  locales: string[];
}

/**
 * Campos obligatorios que quedarán vacíos en cada entry que se escribe. Un campo
 * localizado debe tener valor en cada locale que no permite vacíos; uno no localizado,
 * en el locale por defecto. Solo incluye entries con al menos un hueco.
 */
export function requiredGaps(analysis: Analysis, plan: Plan): Map<string, RequiredGap[]> {
  const { locales, diffs, dstEntries, contentTypes } = analysis;
  const gaps = new Map<string, RequiredGap[]>();

  for (const { id, action, entry } of plan.entries) {
    const ctId = contentTypeOf(entry);
    const ct = projectedContentType(ctId, analysis, plan);
    if (!ct) continue;

    const source = { locales: locales.src, ct: contentTypes.src.get(ctId) };
    const writable = writableFields(ct, diffs.get(ctId));
    const incoming = fieldsForDestination(entry, writable, locales.dst, source);
    const current: Entry['fields'] = dstEntries.get(id)?.fields ?? {};
    const result = action === ACTION.UPDATE ? mergeWithExisting(current, incoming, writable, source) : incoming;

    const defaultLocale = locales.dst.default ? [locales.dst.default] : [];
    const entryGaps = ct.fields
      .filter((f) => f.required && !f.disabled && !f.omitted)
      .map((field) => ({
        field,
        locales: (field.localized ? [...locales.dst.required] : defaultLocale).filter((locale) =>
          isBlank(result[field.id]?.[locale]),
        ),
      }))
      .filter((gap) => gap.locales.length > 0);
    if (entryGaps.length) gaps.set(id, entryGaps);
  }
  return gaps;
}
