/**
 * Comparar valores como texto, palabra por palabra: para resaltar qué cambia en un campo (lo
 * quitado y lo agregado) y poder verlo completo. Funciones puras.
 */
import { exactJson } from './json.ts';

/** Un código de idioma como clave de un valor por idioma (`es-CO`, `en`). */
const LOCALE_KEY = /^[a-z]{2}(-[A-Za-z0-9]+)*$/;

/** Los valores de un campo, idioma por idioma; `undefined` si el valor no va por idioma. */
export function byLocale(value: unknown): [string, unknown][] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length && entries.every(([key]) => LOCALE_KEY.test(key)) ? entries : undefined;
}

interface RichNode {
  nodeType?: string;
  value?: string;
  content?: RichNode[];
  data?: { target?: unknown };
}

/** Nodos de un rich text que van dentro de una línea (no son un bloque). */
const INLINE = new Set([
  'text',
  'hyperlink',
  'entry-hyperlink',
  'asset-hyperlink',
  'resource-hyperlink',
  'embedded-entry-inline',
  'embedded-resource-inline',
]);

/** Entries y archivos embebidos en un rich text: se muestran como `[→ id]`. */
const EMBEDDED = new Set([
  'embedded-entry-block',
  'embedded-asset-block',
  'embedded-resource-block',
  'embedded-entry-inline',
  'embedded-resource-inline',
]);

/** Un link como `→ id`. Si quien llama ya puso un texto en su lugar (un título), ese texto. */
const linkText = (link: unknown): string =>
  typeof link === 'string' ? link : `→ ${(link as { sys?: { id?: string } } | undefined)?.sys?.id ?? '?'}`;

/** Va dentro de una línea: un texto (todo nodo con `value`), un enlace o algo embebido en línea. */
const isInline = (node: RichNode) => typeof node.value === 'string' || INLINE.has(node.nodeType ?? '');

/** El texto de un rich text: cada bloque (párrafo, título, ítem de lista) en su propia línea. */
export function richTextOf(node: RichNode): string {
  const type = node.nodeType ?? '';
  if (typeof node.value === 'string') return node.value;
  if (EMBEDDED.has(type)) return `[${linkText(node.data?.target)}]`;
  if (type === 'hr') return '———';
  const children = node.content ?? [];
  const texts = children.map(richTextOf);
  if (type === 'table-row') return texts.join(' | ');
  const text = texts.join(children.every(isInline) ? '' : '\n');
  return type === 'list-item' ? `• ${text}` : text;
}

/**
 * El texto completo de un valor, sin recortar: un texto tal cual, un rich text con un bloque por
 * línea, una lista separada por comas, un link como `→ id`. Un valor por idioma da cada idioma
 * en su línea; para compararlos por separado, `diffFieldValues`.
 */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueText).join(', ');
  const node = value as RichNode & { sys?: { type?: string } };
  if (node.sys?.type === 'Link') return linkText(node);
  if (node.nodeType === 'document')
    return richTextOf(node)
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  const locales = byLocale(value);
  if (locales) return locales.map(([locale, v]) => `${locale}: ${valueText(v)}`).join('\n');
  return exactJson(value);
}

export const TEXT = {
  SAME: 'same',
  REMOVED: 'removed', // estaba antes y ya no
  ADDED: 'added', // no estaba y queda
} as const;

export type TextPartKind = (typeof TEXT)[keyof typeof TEXT];

/** Un tramo del texto: igual en los dos lados, quitado o agregado. */
export interface TextPart {
  kind: TextPartKind;
  text: string;
}

/** La unidad del diff: palabras, espacios y signos. Cambiar una letra marca la palabra entera. */
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

/** Más palabras que esto (de un lado por las del otro) y el tramo distinto se marca entero: sería lento. */
const MAX_CELLS = 1_000_000;

/**
 * Qué cambia de `before` a `after`, palabra por palabra. Juntando lo igual y lo quitado sale
 * `before`; lo igual y lo agregado, `after`. En cada cambio, primero lo quitado.
 */
export function diffText(before: string, after: string): TextPart[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  // Lo igual al principio y al final no entra al diff fino (casi siempre es casi todo).
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return tidy([
    ...a.slice(0, start).map((text) => ({ kind: TEXT.SAME, text })),
    ...middleDiff(a.slice(start, endA), b.slice(start, endB)),
    ...a.slice(endA).map((text) => ({ kind: TEXT.SAME, text })),
  ]);
}

/** El diff palabra por palabra del tramo que cambia (la subsecuencia común más larga). */
function middleDiff(a: string[], b: string[]): TextPart[] {
  const removed = (text: string) => ({ kind: TEXT.REMOVED, text });
  const added = (text: string) => ({ kind: TEXT.ADDED, text });
  if (!a.length || !b.length || a.length * b.length > MAX_CELLS) return [...a.map(removed), ...b.map(added)];

  const width = b.length + 1;
  const common = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number) => common[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i * width + j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));

  const parts: TextPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      parts.push({ kind: TEXT.SAME, text: a[i] as string });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) parts.push(removed(a[i++] as string));
    else parts.push(added(b[j++] as string));
  }
  return [...parts, ...a.slice(i).map(removed), ...b.slice(j).map(added)];
}

/**
 * Junta los tramos para que se lean bien: lo igual seguido en uno solo; un espacio suelto entre
 * una palabra cambiada y la siguiente ("Hola mundo" → "Adiós amigo") va con el cambio; en cada
 * cambio, todo lo quitado y después todo lo agregado.
 */
function tidy(parts: TextPart[]): TextPart[] {
  // Entre un cambio de un tipo y uno del otro: entre dos quitados (o dos agregados) se queda igual.
  const isGap = (i: number) => {
    const [prev, part, next] = [parts[i - 1], parts[i], parts[i + 1]];
    return (
      part?.kind === TEXT.SAME &&
      !part.text.trim() &&
      prev !== undefined &&
      next !== undefined &&
      prev.kind !== TEXT.SAME &&
      next.kind !== TEXT.SAME &&
      prev.kind !== next.kind
    );
  };
  const out: TextPart[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    if (removed) out.push({ kind: TEXT.REMOVED, text: removed });
    if (added) out.push({ kind: TEXT.ADDED, text: added });
    removed = '';
    added = '';
  };
  parts.forEach((part, i) => {
    const gap = isGap(i);
    if (part.kind === TEXT.REMOVED || gap) removed += part.text;
    if (part.kind === TEXT.ADDED || gap) added += part.text;
    if (part.kind !== TEXT.SAME || gap) return;
    flush();
    const last = out[out.length - 1];
    if (last?.kind === TEXT.SAME) last.text += part.text;
    else out.push({ kind: TEXT.SAME, text: part.text });
  });
  flush();
  return out;
}

/** La comparación de un campo en un idioma, como texto. */
export interface LocaleTextDiff {
  /** El idioma; `undefined` si el valor no va por idioma (como los tags). */
  locale: string | undefined;
  /** El texto completo de cada lado; `undefined` si ese lado está vacío. */
  before: string | undefined;
  after: string | undefined;
  parts: TextPart[];
  changed: boolean;
}

/**
 * Compara dos valores de un campo como texto, idioma por idioma: primero los idiomas de `after`
 * y después los que solo tiene `before`. Sirve para resaltar qué cambia y verlo completo.
 */
export function diffFieldValues(before: unknown, after: unknown): LocaleTextDiff[] {
  const sides = (value: unknown) =>
    new Map<string | undefined, unknown>(value === undefined ? [] : (byLocale(value) ?? [[undefined, value]]));
  const a = sides(before);
  const b = sides(after);
  return [...new Set([...b.keys(), ...a.keys()])].map((locale) => {
    const beforeText = a.has(locale) ? valueText(a.get(locale)) : undefined;
    const afterText = b.has(locale) ? valueText(b.get(locale)) : undefined;
    return {
      locale,
      before: beforeText,
      after: afterText,
      parts: diffText(beforeText ?? '', afterText ?? ''),
      changed: beforeText !== afterText,
    };
  });
}
