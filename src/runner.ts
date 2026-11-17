/**
 * Quién corre las escrituras de cada fase (tags, modelo, imágenes, entries) y muestra el avance.
 * El núcleo solo pide este contrato: el CLI lo implementa con barras de progreso y una web, con
 * su propia pantalla. Si una escritura falla, se anota y se sigue con las demás.
 */
import { formatError } from './errors.ts';

export interface Runner {
  /** Etiquetas de las escrituras que fallaron, en todas las fases. */
  failures: string[];
  /** Empieza una fase con `total` escrituras. */
  start(title: string, total: number): void;
  /** Corre una escritura; si falla, la anota y no lanza. */
  run(label: string, fn: () => Promise<unknown>): Promise<void>;
  /** Una escritura que no se puede hacer (por ejemplo, falta su content type). */
  fail(label: string, reason: string): void;
  /** Cierra la fase. */
  end(): void;
}

export interface PhaseResult {
  title: string;
  total: number;
  results: { label: string; ok: boolean; error?: string }[];
}

/**
 * Runner sin pantalla: guarda el resultado de cada escritura por fase. Sirve para un backend,
 * una web (que pinta `phases` como quiera) y los tests. `onChange` avisa en cada avance.
 */
export function createRecordingRunner(onChange?: (phases: PhaseResult[]) => void): Runner & { phases: PhaseResult[] } {
  const phases: PhaseResult[] = [];
  const failures: string[] = [];
  const current = () => {
    const phase = phases.at(-1);
    if (!phase) throw new Error('runner: falta start()');
    return phase;
  };
  const record = (label: string, error?: string) => {
    current().results.push(error === undefined ? { label, ok: true } : { label, ok: false, error });
    if (error !== undefined) failures.push(label);
    onChange?.(phases);
  };
  return {
    phases,
    failures,
    start(title, total) {
      phases.push({ title, total, results: [] });
      onChange?.(phases);
    },
    async run(label, fn) {
      try {
        await fn();
        record(label);
      } catch (e) {
        record(label, formatError(e));
      }
    },
    fail: (label, reason) => record(label, reason),
    end() {},
  };
}
