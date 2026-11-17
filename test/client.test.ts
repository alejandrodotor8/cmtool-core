import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CMA_HOST_NAMES, createCma, describeRequest } from '../src/contentful/client.ts';
import { AbortError } from '../src/errors.ts';

describe('describeRequest', () => {
  test('muestra método, ruta y parámetros', () => {
    assert.equal(
      describeRequest({
        method: 'get',
        url: '/spaces/s1/environments/qa/entries',
        params: { 'sys.id[in]': 'a,b', limit: 2 },
      }),
      'GET /spaces/s1/environments/qa/entries?sys.id[in]=a,b&limit=2',
    );
  });

  test('nunca muestra los headers, que llevan el token', () => {
    const request = {
      method: 'put',
      url: '/spaces/s1/environments/qa/entries/e1',
      headers: { Authorization: 'Bearer SECRETO123' },
    };
    const text = describeRequest(request);
    assert.equal(text, 'PUT /spaces/s1/environments/qa/entries/e1');
    assert.equal(text.includes('SECRETO123'), false);
  });
});

describe('createCma', () => {
  for (const host of ['evil.example.com', 'api.contentful.com.evil.com', 'constructor']) {
    test(`no crea un cliente que mande el token a un host que no es de Contentful: ${host}`, () => {
      assert.throws(() => createCma({ token: 't', host }), AbortError);
    });
  }

  test('acepta los hosts de Contentful (sin hacer ninguna llamada)', () => {
    assert.deepEqual(CMA_HOST_NAMES, ['api.contentful.com', 'api.eu.contentful.com']);
    for (const host of CMA_HOST_NAMES) assert.ok(createCma({ token: 't', host }));
    assert.ok(createCma({ token: 't' }), 'sin host, el normal');
  });
});
