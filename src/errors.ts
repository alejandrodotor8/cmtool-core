/**
 * Errores del núcleo: los que cualquier herramienta (CLI, web, backend) puede mostrar tal cual.
 */

/** Error esperado: corta el flujo mostrando un mensaje claro, sin stack trace. */
export class AbortError extends Error {
  readonly hint: string | undefined;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'AbortError';
    this.hint = hint;
  }
}

/** Lo que trae el mensaje (JSON) de un error del CMA. */
interface CmaErrorBody {
  status?: number;
  statusText?: string;
  message?: string;
  details?: { errors?: { name: string; path?: (string | number)[]; details?: string }[] };
}

/** El status HTTP de un error del CMA (401, 404…), o `undefined` si no es uno. */
export function statusOf(e: unknown): number | undefined {
  try {
    const { status } = JSON.parse(e instanceof Error ? e.message : String(e)) as CmaErrorBody;
    return typeof status === 'number' ? status : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mensaje legible de un error del CMA. Solo usa status, mensaje y detalles:
 * nunca imprime la request, que lleva el token en los headers.
 */
export function formatError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  try {
    const body = JSON.parse(message) as CmaErrorBody;
    const details = (body.details?.errors ?? [])
      .map((d) => `${d.name}${d.path ? ` en ${d.path.join('.')}` : ''}${d.details ? `: ${d.details}` : ''}`)
      .join('; ');
    const conflict =
      e instanceof Error && e.name === 'VersionMismatch'
        ? ' (alguien la modificó al mismo tiempo en Contentful; vuelve a intentarlo)'
        : '';
    return `${body.status} ${body.statusText}: ${body.message}${details ? ` → ${details}` : ''}${conflict}`;
  } catch {
    return message;
  }
}
