import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { looksLikeProduction, resolveEnvironment, sortEnvironments } from '../src/core/environments.ts';

describe('resolveEnvironment', () => {
  const envs = [
    { id: 'develop', aliases: [] },
    { id: 'master-2026-10', aliases: ['master'] },
  ];

  test('por ID', () => {
    assert.equal(resolveEnvironment(envs, 'develop'), 'develop');
  });

  test('por alias', () => {
    assert.equal(resolveEnvironment(envs, 'master'), 'master-2026-10');
  });

  test('si no existe, nada', () => {
    assert.equal(resolveEnvironment(envs, 'qa'), undefined);
  });
});

describe('orden de los ambientes', () => {
  const env = (id: string, aliases: string[] = []) => ({ id, aliases });

  test('desarrollo primero, pruebas después y producción al final', () => {
    const envs = [env('master'), env('qa'), env('feature-x'), env('develop'), env('staging')];
    assert.deepEqual(
      sortEnvironments(envs).map((e) => e.id),
      ['develop', 'qa', 'staging', 'feature-x', 'master'],
    );
  });

  test('un ambiente con alias (el alias master apunta a producción) va al final y cuenta como producción', () => {
    const prod = env('prod-2026-10', ['master']);
    assert.deepEqual(
      sortEnvironments([prod, env('develop')]).map((e) => e.id),
      ['develop', 'prod-2026-10'],
    );
    assert.equal(looksLikeProduction(prod), true);
    assert.equal(looksLikeProduction(env('qa')), false);
  });
});
