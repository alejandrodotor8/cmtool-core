/**
 * Reportes en Markdown para compartir con el equipo. Usan los mismos textos que la
 * terminal (ui/text.ts), sin colores. Funciones puras.
 */
import { type FieldComparison, summarizeValue, VALUE } from '../core/entry-compare.ts';
import { type ContentTypeDiff, fieldType, hasDifferences, type ModelComparison } from '../core/model.ts';
import type { EditorDiffs } from '../core/model-changes.ts';
import type { EnvironmentStatus } from '../core/status.ts';
import { contentTypeStatusParts, ctInfoText, editorDiffText, fieldStatusText } from '../text.ts';

const cell = (value: string | number) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Tabla Markdown. */
export function mdTable(headers: string[], rows: (string | number)[][]): string {
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');
}

interface Envs {
  src: string;
  dst: string;
}

const header = (title: string, { src, dst }: Envs, now: Date) =>
  `# ${title}: ${src} → ${dst}\n\n_Generado el ${now.toLocaleString('es-CO')}._`;

const ctStatus = (diff: ContentTypeDiff, dst: string, editorFields = 0) =>
  contentTypeStatusParts(diff, dst, editorFields).join(' · ') || 'al día';

function modelOverview(
  { diffs, onlyInDst }: ModelComparison,
  dst: string,
  editorDiffs: EditorDiffs = new Map(),
): string {
  return mdTable(
    ['Content type', 'ID', 'Campos', 'Estado'],
    [
      ...diffs.map((d) => [d.name, d.id, d.rows.length, ctStatus(d, dst, editorDiffs.get(d.id)?.length)]),
      ...onlyInDst.map((ct) => [ct.name, ct.sys.id, ct.fields.length, `solo existe en ${dst}`]),
    ],
  );
}

export function modelComparisonReport(
  comparison: ModelComparison,
  envs: Envs & { dstDefault: string | undefined },
  editorDiffs: EditorDiffs = new Map(),
  now = new Date(),
): string {
  const details = comparison.diffs.filter(hasDifferences).map((diff) =>
    [
      `### ${diff.name} (\`${diff.id}\`) — ${ctStatus(diff, envs.dst, editorDiffs.get(diff.id)?.length)}`,
      ...(diff.info.length ? [ctInfoText(diff, envs.dst)] : []),
      mdTable(
        ['Campo', 'ID', 'Tipo', 'Estado'],
        diff.rows.map((row) => [
          row.field.name,
          row.field.id,
          fieldType(row.field),
          fieldStatusText(
            row,
            envs.dst,
            envs.dstDefault,
            editorDiffs.get(diff.id)?.find((e) => e.fieldId === row.field.id),
          ),
        ]),
      ),
    ].join('\n\n'),
  );
  const names = new Map(comparison.diffs.map((d) => [d.id, d]));
  const editor = [...editorDiffs].flatMap(([ctId, fields]) => {
    const diff = names.get(ctId);
    const fieldName = new Map(diff?.rows.map((r) => [r.field.id, r.field.name]));
    return fields.map((e) => [diff?.name ?? ctId, fieldName.get(e.fieldId) ?? e.fieldId, editorDiffText(e, envs.dst)]);
  });
  return [
    header('Comparación de modelos', envs, now),
    '## Resumen',
    modelOverview(comparison, envs.dst, editorDiffs),
    ...(details.length ? ['## Diferencias', ...details] : []),
    ...(editor.length
      ? [
          '## Apariencia del editor distinta (help text, widget)',
          mdTable(['Content type', 'Campo', 'Qué difiere'], editor),
        ]
      : []),
  ].join('\n\n');
}

export function statusReport(status: EnvironmentStatus, model: ModelComparison, envs: Envs, now = new Date()): string {
  const ct = status.contentTypes;
  const list = (items: string[]) => (items.length ? items.join(', ') : '—');
  return [
    header('Estado de los ambientes', envs, now),
    mdTable(
      ['', 'Resultado'],
      [
        [
          'Content types',
          `${ct.same.length} iguales · ${ct.different.length} con diferencias · ${ct.missingInDst.length} no existen en ${envs.dst} · ${ct.onlyInDst.length} solo en ${envs.dst}`,
        ],
        ['Idiomas que faltan en destino', list(status.locales.missingInDst)],
        ['Tags que faltan en destino', list(status.tags.missingInDst)],
      ],
    ),
    '## Content types',
    modelOverview(model, envs.dst),
  ].join('\n\n');
}

const VALUE_TEXT = {
  [VALUE.SAME]: 'igual',
  [VALUE.DIFFERENT]: 'distinto',
  [VALUE.ONLY_SRC]: 'solo en origen',
  [VALUE.ONLY_DST]: 'solo en destino',
};

export function entryComparisonReport(
  items: { id: string; title: string; exists: { src: boolean; dst: boolean }; fields: FieldComparison[] }[],
  envs: Envs,
  now = new Date(),
): string {
  const sections = items.map((item) => {
    const heading = `## ${item.title} (\`${item.id}\`)`;
    if (!item.exists.src) return `${heading}\n\nNo existe en ${envs.src}.`;
    if (!item.exists.dst) return `${heading}\n\nNo existe en ${envs.dst}.`;
    return [
      heading,
      mdTable(
        ['Campo', envs.src, envs.dst, 'Estado'],
        item.fields.map((f) => [f.name, summarizeValue(f.src, 80), summarizeValue(f.dst, 80), VALUE_TEXT[f.status]]),
      ),
    ].join('\n\n');
  });
  return [header('Comparación de entries', envs, now), ...sections].join('\n\n');
}
