/** Formato de un ID de Contentful: letras, números, punto, guion y guion bajo (hasta 64). */
const CONTENTFUL_ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface ParsedIds {
  /** IDs válidos, sin repetidos y en el orden en que llegaron. */
  ids: string[];
  /** Lo que no es un ID ni la URL del tipo pedido. */
  invalid: string[];
}

/**
 * Lee IDs de Contentful o URLs copiadas del navegador (que terminan en `/entries/<id>` o
 * `/assets/<id>`, según `kind`). Acepta como separador coma, punto y coma, espacio,
 * tabulación y salto de línea: sirve pegar una columna o una fila de Excel.
 */
export function parseIds(text: string, kind: 'entries' | 'assets'): ParsedIds {
  const ids: string[] = [];
  const invalid: string[] = [];
  const segment = `/${kind}/`;
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ''))
    .filter(Boolean);

  for (const token of tokens) {
    const id = token.includes(segment) ? (token.split(segment)[1]?.split(/[/?#]/)[0] ?? '') : token;
    if (CONTENTFUL_ID.test(id)) ids.push(id);
    else invalid.push(token);
  }
  return { ids: [...new Set(ids)], invalid };
}

/** Entry IDs o URLs de entries. */
export const parseEntryIds = (text: string): ParsedIds => parseIds(text, 'entries');
