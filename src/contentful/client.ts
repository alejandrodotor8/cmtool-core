import { createClient } from 'contentful-management';
import { AbortError } from '../errors.ts';
import type { Cma } from './types.ts';

/** Hosts del CMA a los que se permite enviar el token, con su app web. */
export const CMA_HOSTS: ReadonlyMap<string, string> = new Map([
  ['api.contentful.com', 'app.contentful.com'],
  ['api.eu.contentful.com', 'app.eu.contentful.com'],
]);

/** Los hosts permitidos, en el orden en que se prueba un token nuevo (primero el normal, después EU). */
export const CMA_HOST_NAMES = [...CMA_HOSTS.keys()];

/** Token y host para hablar con el CMA. */
export interface Credentials {
  token: string;
  /** Uno de CMA_HOSTS (por defecto, api.contentful.com). */
  host?: string;
}

/** Se llama en cada petición a la API (incluidos los reintentos) con una descripción sin datos sensibles. */
export type RequestListener = (request: string) => void;

interface RequestInfo {
  method?: string;
  url?: string;
  params?: Record<string, unknown>;
}

/** "GET /spaces/…/entries?limit=50": solo método, ruta y parámetros. Nunca headers (llevan el token). */
export function describeRequest({ method, url, params }: RequestInfo): string {
  const query = Object.entries(params ?? {})
    .map(([key, value]) => `${key}=${String(value)}`)
    .join('&');
  return `${(method ?? 'get').toUpperCase()} ${url ?? ''}${query ? `?${query}` : ''}`;
}

/**
 * Cliente "plain" del CMA. Con `spaceId`, todas las llamadas quedan dentro de ese space.
 * El token solo se envía a un host de CMA_HOSTS: con otro, se detiene antes de crear el cliente.
 */
export function createCma(
  { token, host = 'api.contentful.com' }: Credentials,
  spaceId?: string,
  onRequest?: RequestListener,
): Cma {
  if (!CMA_HOSTS.has(host)) throw new AbortError(`El host "${host}" no es de Contentful; no envío el token ahí.`);
  return createClient(
    {
      accessToken: token,
      host,
      requestLogger: (request: unknown) => {
        if (onRequest && !(request instanceof Error)) onRequest(describeRequest(request as RequestInfo));
      },
    },
    { type: 'plain', defaults: spaceId ? { spaceId } : undefined },
  );
}
