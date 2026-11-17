import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatError, statusOf } from '../src/errors.ts';

describe('formatError', () => {
  test('muestra status, mensaje y detalles, pero nunca la request con el token', () => {
    const body = {
      status: 422,
      statusText: 'Unprocessable Entity',
      message: 'Validation error',
      details: { errors: [{ name: 'required', path: ['fields', 'title'] }] },
      request: { headers: { Authorization: 'Bearer SECRETO123' } },
    };
    const msg = formatError(new Error(JSON.stringify(body)));
    assert.equal(msg, '422 Unprocessable Entity: Validation error → required en fields.title');
    assert.equal(msg.includes('SECRETO123'), false);
  });

  test('un conflicto de versión explica qué pasó', () => {
    const e = new Error(JSON.stringify({ status: 409, statusText: 'Conflict', message: 'Version mismatch' }));
    e.name = 'VersionMismatch';
    assert.match(formatError(e), /^409 Conflict: Version mismatch \(alguien la modificó al mismo tiempo/);
  });

  test('un error que no es del CMA se muestra tal cual', () => {
    assert.equal(formatError(new Error('se cayó la red')), 'se cayó la red');
    assert.equal(formatError('texto'), 'texto');
  });
});

describe('statusOf', () => {
  test('lee el status de un error del CMA, y nada de otros errores', () => {
    assert.equal(statusOf(new Error(JSON.stringify({ status: 401, statusText: 'Unauthorized' }))), 401);
    assert.equal(statusOf(new Error('sin red')), undefined);
    assert.equal(statusOf(new Error('null')), undefined);
    assert.equal(statusOf(undefined), undefined);
  });
});
