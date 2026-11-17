import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { BackupData } from '../src/backup.ts';
import type { Account, Entry } from '../src/contentful/types.ts';
import { AbortError } from '../src/errors.ts';
import { accountBackupDir, listBackups, readBackup, startBackup } from '../src/node/backups.ts';
import { entry, field } from './fixtures.ts';

const alejandro: Account = { userId: 'u-ale', email: 'ale@dislicores.com', host: 'api.contentful.com' };
const otra: Account = { userId: 'u-otra', email: 'otra@agencia.com', host: 'api.contentful.com' };

const meta: Pick<BackupData, 'kind' | 'spaceId' | 'src' | 'dst' | 'rootIds'> & { account: Account } = {
  kind: 'migrate',
  account: alejandro,
  spaceId: 's1',
  src: 'develop',
  dst: 'qa',
  rootIds: ['banner'],
};

describe('backup', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfm-backup-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('crea el archivo apenas empieza, antes de cualquier cambio', () => {
    const backup = startBackup(meta, dir);
    const data = readBackup(backup.file);
    assert.equal(data.dst, 'qa');
    assert.deepEqual(data.updated, []);
  });

  test('el nombre del archivo no tiene ":" (válido en Windows)', () => {
    const backup = startBackup(meta, dir);
    assert.equal(path.basename(backup.file).includes(':'), false);
  });

  test('guarda en disco cada cambio, con lo necesario para restaurar', () => {
    const backup = startBackup(meta, dir);
    const current = entry('banner', 'banner', { title: { 'es-CO': 'Antes' } }, ['navidad']);
    (current.sys as Entry['sys']).version = 7;

    backup.recordUpdate(current, 'Banner');
    backup.recordCreated('entries', 'slide');
    backup.recordFields('banner', ['subtitle']);
    backup.recordRules('banner', [field('title')]);

    const data = readBackup(backup.file);
    assert.deepEqual(data.updated[0], {
      id: 'banner',
      contentType: 'banner',
      title: 'Banner',
      version: 7,
      fields: { title: { 'es-CO': 'Antes' } },
      tags: [{ sys: { type: 'Link', linkType: 'Tag', id: 'navidad' } }],
      applied: false,
    });
    assert.deepEqual(data.created.entries, ['slide']);
    assert.deepEqual(data.fieldsAdded, { banner: ['subtitle'] });
    assert.deepEqual(data.rulesUpdated, { banner: [field('title')] });
  });

  test('marca como aplicada una entry solo cuando se confirma su actualización', () => {
    const backup = startBackup(meta, dir);
    backup.recordUpdate(entry('a', 'banner'), 'A');
    backup.recordUpdate(entry('b', 'banner'), 'B');
    backup.confirmUpdate('a');
    assert.deepEqual(
      readBackup(backup.file).updated.map((e) => [e.id, e.applied]),
      [
        ['a', true],
        ['b', false],
      ],
    );
  });

  test('solo el usuario puede leer el respaldo', { skip: process.platform === 'win32' }, () => {
    const backup = startBackup(meta, dir);
    assert.equal(fs.statSync(backup.file).mode & 0o777, 0o600);
  });

  test('guarda cada respaldo en la carpeta de su cuenta y registra la cuenta', () => {
    const backup = startBackup(meta, dir);
    assert.equal(path.dirname(backup.file), accountBackupDir(alejandro, dir));
    assert.deepEqual(readBackup(backup.file).account, alejandro);
  });

  test('cada cuenta ve solo sus respaldos, del más reciente al más antiguo', () => {
    const write = (account: Account, name: string, createdAt: string) => {
      const folder = accountBackupDir(account, dir);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, name), JSON.stringify({ version: 1, createdAt, account, updated: [] }));
    };
    write(alejandro, 'viejo.json', '2026-01-01T00:00:00.000Z');
    write(alejandro, 'nuevo.json', '2026-06-01T00:00:00.000Z');
    write(otra, 'de-otra.json', '2026-07-01T00:00:00.000Z');
    fs.writeFileSync(path.join(accountBackupDir(alejandro, dir), 'roto.json'), '{no es json');

    const names = (account: Account) => listBackups(account, dir).mine.map((b) => path.basename(b.file));
    assert.deepEqual(names(alejandro), ['nuevo.json', 'viejo.json']);
    assert.deepEqual(names(otra), ['de-otra.json']);
  });

  test('los respaldos anteriores (sin cuenta, en la carpeta raíz) se listan aparte', () => {
    fs.writeFileSync(
      path.join(dir, 'anterior.json'),
      JSON.stringify({ version: 1, createdAt: '2026-10-05T00:00:00Z', updated: [] }),
    );
    fs.writeFileSync(path.join(dir, 'otro.txt'), 'x');
    const { mine, legacy } = listBackups(alejandro, dir);
    assert.deepEqual(mine, []);
    assert.deepEqual(
      legacy.map((b) => path.basename(b.file)),
      ['anterior.json'],
    );
  });

  test('el ID de la cuenta no puede salirse de la carpeta de respaldos', () => {
    for (const userId of ['../../etc', '..', '.']) {
      assert.equal(path.dirname(accountBackupDir({ userId }, dir)), dir, userId);
    }
  });

  test('si no hay carpeta de respaldos, la lista está vacía', () => {
    assert.deepEqual(listBackups(alejandro, path.join(dir, 'no-existe')), { mine: [], legacy: [] });
  });

  test('un respaldo ilegible se detiene con un mensaje claro', () => {
    const file = path.join(dir, 'roto.json');
    fs.writeFileSync(file, '{no es json');
    assert.throws(() => readBackup(file), AbortError);
  });
});
