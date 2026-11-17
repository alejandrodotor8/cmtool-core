/**
 * Respaldos en archivos (solo Node): cmtool-core/node. Se guardan en ~/.ctf-migrate/backups/<usuario>/,
 * una carpeta por cuenta de Contentful para que no se mezclen, legibles solo por el usuario del
 * sistema. La carpeta conserva el nombre anterior de la herramienta para no perder los que ya existen.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type BackupData, createBackup, isBackup } from '../backup.ts';
import type { Account } from '../contentful/types.ts';
import { AbortError } from '../errors.ts';

const BACKUP_DIR = path.join(os.homedir(), '.ctf-migrate', 'backups');

/** Carpeta de respaldos de una cuenta (el ID solo con letras, números, - y _: no puede salirse de la raíz). */
export const accountBackupDir = (account: Pick<Account, 'userId'>, root = BACKUP_DIR) =>
  path.join(root, account.userId.replace(/[^A-Za-z0-9_-]/g, '_'));

/**
 * Crea el archivo de respaldo y lo vuelve a guardar en cada cambio, para que quede
 * completo aunque el proceso se corte a la mitad.
 */
export function startBackup(meta: Parameters<typeof createBackup>[0], root = BACKUP_DIR) {
  const dir = accountBackupDir(meta.account, root);
  const createdAt = new Date().toISOString();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Sin ":" en el nombre, para que también sea válido en Windows.
  const file = path.join(dir, `${createdAt.replace(/[:.]/g, '-')}_${meta.kind}_${meta.dst}.json`);
  const save = (data: BackupData) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  return { file, ...createBackup(meta, save, createdAt) };
}

function tryRead(file: string): BackupData | undefined {
  try {
    const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isBackup(data) ? data : undefined;
  } catch {
    return undefined;
  }
}

export function readBackup(file: string): BackupData {
  const data = tryRead(file);
  if (!data) throw new AbortError(`No pude leer el respaldo ${file}.`);
  return data;
}

export type BackupFile = { file: string; data: BackupData };

/** Respaldos (`.json` válidos) de una carpeta, del más reciente al más antiguo. */
function readDir(dir: string): BackupFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const file = path.join(dir, name);
      const data = tryRead(file);
      return data ? [{ file, data }] : [];
    })
    .sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
}

/**
 * Respaldos de una cuenta (`mine`) y los anteriores a 0.6.0, que no registran cuenta
 * (`legacy`). Los de otras cuentas no aparecen.
 */
export function listBackups(
  account: Pick<Account, 'userId'>,
  root = BACKUP_DIR,
): { mine: BackupFile[]; legacy: BackupFile[] } {
  return {
    mine: readDir(accountBackupDir(account, root)),
    legacy: readDir(root).filter(({ data }) => !data.account),
  };
}
