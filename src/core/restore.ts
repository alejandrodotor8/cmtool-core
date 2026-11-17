import type { BackupData, SavedEntry } from '../backup.ts';
import type { Account, Entry } from '../contentful/types.ts';

export const RESTORE = {
  RESTORE: 'restore', // nadie la tocó después de la migración
  CHANGED: 'changed', // alguien la editó o publicó después: restaurar también deshace eso
  MISSING: 'missing', // ya no existe en destino: se omite
  NOT_APPLIED: 'not-applied', // la actualización falló durante la migración: no hay nada que deshacer
} as const;

export type RestoreStatus = (typeof RESTORE)[keyof typeof RESTORE];

/**
 * Qué pasa al restaurar una entry. La migración hace una sola actualización, que deja
 * la versión en `respaldo + 1`; cualquier otra versión significa que hubo cambios después.
 */
export function restoreStatus(saved: SavedEntry, current: Entry | undefined): RestoreStatus {
  if (saved.applied === false) return RESTORE.NOT_APPLIED;
  if (!current) return RESTORE.MISSING;
  return current.sys.version === saved.version + 1 ? RESTORE.RESTORE : RESTORE.CHANGED;
}

/** Se restaura si nadie la tocó o si se editó después (avisando); el resto se omite. */
export const shouldRestore = (status: RestoreStatus): boolean =>
  status === RESTORE.RESTORE || status === RESTORE.CHANGED;

export const OWNER = {
  SAME: 'same', // lo hizo la cuenta con la que iniciaste sesión
  LEGACY: 'legacy', // anterior a 0.6.0: no registra cuenta
  OTHER: 'other', // lo hizo otra cuenta (u otra región)
} as const;

export type Owner = (typeof OWNER)[keyof typeof OWNER];

/** De quién es un respaldo, comparado con la cuenta actual (usuario y región). */
export function backupOwner({ account }: Pick<BackupData, 'account'>, current: Account): Owner {
  if (!account) return OWNER.LEGACY;
  return account.userId === current.userId && account.host === current.host ? OWNER.SAME : OWNER.OTHER;
}
