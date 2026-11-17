import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cache, remember } from '../src/core/cache.ts';

describe('cache', () => {
  test('cada clave se lee una sola vez, aunque se pida mientras todavía carga', async () => {
    let reads = 0;
    const read = remember(async (key) => {
      reads++;
      return key.toUpperCase();
    });
    const [a, b] = await Promise.all([read('develop'), read('develop')]);
    assert.deepEqual([a, b, await read('develop'), await read('qa')], ['DEVELOP', 'DEVELOP', 'DEVELOP', 'QA']);
    assert.equal(reads, 2);
  });

  test('una lectura que falla se olvida: la siguiente vuelve a intentar', async () => {
    let attempts = 0;
    const read = remember(async () => {
      attempts++;
      if (attempts === 1) throw new Error('sin red');
      return 'ok';
    });
    await assert.rejects(read('spaces'), /sin red/);
    assert.equal(await read('spaces'), 'ok');
    assert.equal(attempts, 2);
  });

  test('cache recibe la lectura en cada llamada (para claves armadas por quien la usa)', async () => {
    const cached = cache<number>();
    assert.equal(await cached('a', async () => 1), 1);
    assert.equal(await cached('a', async () => 2), 1);
  });
});
