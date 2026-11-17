import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SavedEntry } from '../src/backup.ts';
import type { Entry } from '../src/contentful/types.ts';
import { backupOwner, OWNER, RESTORE, restoreStatus, shouldRestore } from '../src/core/restore.ts';
import { entry } from './fixtures.ts';

const saved: SavedEntry = {
  id: 'banner',
  contentType: 'banner',
  title: 'Banner',
  version: 7,
  fields: {},
  tags: [],
  applied: true,
};

const withVersion = (version: number): Entry => {
  const e = entry('banner', 'banner');
  (e.sys as Entry['sys']).version = version;
  return e;
};

describe('restoreStatus', () => {
  test('si nadie la tocó después de migrar (versión + 1), se restaura', () => {
    assert.equal(restoreStatus(saved, withVersion(8)), RESTORE.RESTORE);
  });

  test('si alguien la editó o publicó después, se avisa', () => {
    assert.equal(restoreStatus(saved, withVersion(9)), RESTORE.CHANGED);
    assert.equal(restoreStatus(saved, withVersion(12)), RESTORE.CHANGED);
  });

  test('si ya no existe en destino, se omite', () => {
    assert.equal(restoreStatus(saved, undefined), RESTORE.MISSING);
  });

  test('si la migración no la alcanzó a actualizar, se omite', () => {
    assert.equal(restoreStatus({ ...saved, applied: false }, withVersion(7)), RESTORE.NOT_APPLIED);
  });

  test('solo se restauran las que nadie tocó o se editaron después', () => {
    assert.deepEqual(Object.values(RESTORE).filter(shouldRestore), [RESTORE.RESTORE, RESTORE.CHANGED]);
  });
});

describe('backupOwner', () => {
  const ale = { userId: 'u-ale', email: 'ale@dislicores.com', host: 'api.contentful.com' };

  test('el respaldo es de la cuenta actual', () => {
    assert.equal(backupOwner({ account: ale }, ale), OWNER.SAME);
  });

  test('es de otra cuenta, o de la misma cuenta en otra región', () => {
    assert.equal(backupOwner({ account: { ...ale, userId: 'u-otra' } }, ale), OWNER.OTHER);
    assert.equal(backupOwner({ account: { ...ale, host: 'api.eu.contentful.com' } }, ale), OWNER.OTHER);
  });

  test('un respaldo anterior no registra cuenta', () => {
    assert.equal(backupOwner({}, ale), OWNER.LEGACY);
  });
});
