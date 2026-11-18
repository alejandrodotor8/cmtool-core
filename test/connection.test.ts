/** La conexión: lee una sola vez lo que se vuelve a pedir, y el token solo va a Contentful. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { connect, openSpace } from '../src/connection.ts';
import type { Cma } from '../src/contentful/types.ts';
import { AbortError } from '../src/errors.ts';
import { contentType, editorOf, fakeContentful, field } from './fixtures.ts';

describe('openSpace', () => {
  const setup = () =>
    fakeContentful({
      develop: { contentTypes: [contentType('banner', [field('title')])], editors: [editorOf('banner', ['title'])] },
      qa: {},
    });

  test('modelos, idiomas, apariencia y ambientes se leen una sola vez por ambiente', async () => {
    const { cma, count } = setup();
    const space = openSpace(cma);
    for (let i = 0; i < 2; i++) {
      await space.contentTypes('develop');
      await space.locales('develop');
      await space.editorInterfaces('develop');
      await space.environments();
    }
    assert.equal(count('contentType.getMany'), 1);
    assert.equal(count('locale.getMany'), 1);
    assert.equal(count('editorInterface.getMany'), 1);
    assert.equal(count('environment.getMany'), 1);

    await space.contentTypes('qa');
    assert.equal(count('contentType.getMany'), 2, 'otro ambiente es otra lectura');
    assert.deepEqual([...(await space.contentTypes('develop')).keys()], ['banner']);
  });

  test('si una lectura falla, se vuelve a intentar la próxima vez', async () => {
    let calls = 0;
    const cma = {
      contentType: {
        getMany: async () => {
          calls++;
          if (calls === 1) throw new Error('Contentful caído');
          return { items: [], total: 0 };
        },
      },
    } as unknown as Cma;
    const space = openSpace(cma);
    await assert.rejects(space.contentTypes('develop'), /caído/);
    assert.equal((await space.contentTypes('develop')).size, 0);
    assert.equal(calls, 2);
  });
});

describe('connect', () => {
  test('el mismo ID es siempre el mismo space (con lo que ya leyó)', () => {
    const contentful = connect({ token: 'cfm-test' });
    assert.equal(contentful.host, 'api.contentful.com');
    assert.equal(contentful.space('s1'), contentful.space('s1'));
    assert.notEqual(contentful.space('s1'), contentful.space('s2'));
  });

  test('no manda el token a un host que no es de Contentful', () => {
    assert.throws(() => connect({ token: 'cfm-test', host: 'api.example.com' }), AbortError);
  });
});
