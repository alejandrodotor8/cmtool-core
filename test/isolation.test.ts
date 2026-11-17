/** Verifica que test/setup.ts está activo: si alguien lo quita, este test falla. */
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { describe, test } from 'node:test';

describe('aislamiento de los tests', () => {
  test('no hay red: ninguna conexión puede salir', async () => {
    assert.throws(() => https.request('https://api.contentful.com'), /no pueden usar la red/);
    assert.throws(() => http.get('http://example.com'), /no pueden usar la red/);
    assert.throws(() => net.connect(443, 'api.contentful.com'), /no pueden usar la red/);
    await assert.rejects(async () => fetch('https://api.contentful.com'), /no pueden usar la red/);
  });

  test('la carpeta personal es temporal: no se ve tu sesión ni tus respaldos', () => {
    assert.ok(os.homedir().startsWith(os.tmpdir()) || os.homedir().includes('cfm-test-home-'));
    assert.equal(process.env.CONTENTFUL_MANAGEMENT_TOKEN, undefined);
    assert.ok(process.cwd().includes('cfm-test-home-'));
  });
});
