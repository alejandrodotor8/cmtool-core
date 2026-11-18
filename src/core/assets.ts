/**
 * Lo que se muestra de una imagen o archivo: nombre, tipo, medidas, peso y URL. Función pura:
 * la usan las tablas del CLI y las pantallas de una web por igual.
 */
import type { Asset } from '../contentful/types.ts';

export interface AssetInfo {
  /** El título del asset; si no tiene, el nombre del archivo. */
  name: string;
  fileName: string | undefined;
  /** Tipo MIME (`image/png`, `application/pdf`). */
  contentType: string | undefined;
  /** Ancho y alto en px, si es una imagen. */
  dimensions: { width: number; height: number } | undefined;
  /** Peso en bytes. */
  bytes: number | undefined;
  /** URL https del archivo en el CDN de Contentful (para verlo o mostrar una miniatura). */
  url: string | undefined;
}

/** Valor en `locale` o, si no hay, el del primer idioma que tenga. */
const inLocale = <T>(byLocale: Record<string, T> | undefined, locale: string | undefined): T | undefined =>
  (locale ? byLocale?.[locale] : undefined) ?? Object.values(byLocale ?? {})[0];

/** Los datos de un asset en un idioma (por defecto, el primero que tenga). */
export function describeAsset(asset: Asset, locale?: string): AssetInfo {
  const file = inLocale(asset.fields.file, locale);
  const image = file?.details?.image as { width?: number; height?: number } | undefined;
  const url = file?.url ?? file?.upload;
  return {
    name: inLocale(asset.fields.title, locale) || file?.fileName || '(sin nombre)',
    fileName: file?.fileName,
    contentType: file?.contentType,
    dimensions: image?.width && image.height ? { width: image.width, height: image.height } : undefined,
    bytes: typeof file?.details?.size === 'number' ? file.details.size : undefined,
    url: url?.startsWith('//') ? `https:${url}` : url,
  };
}
