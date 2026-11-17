/**
 * Se carga antes de cada archivo de test (`node --import ./test/setup.ts --test …`).
 * Garantiza que los tests son unitarios:
 *  - sin red: cualquier conexión falla, así que ningún test puede llegar a Contentful;
 *  - sin tu carpeta personal: HOME apunta a una carpeta temporal (sin sesión, token ni
 *    respaldos reales), y se trabaja desde ahí.
 */
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';

const noNetwork = (what: string) => () => {
  throw new Error(`Los tests no pueden usar la red (${what}).`);
};

Object.assign(http, { request: noNetwork('http.request'), get: noNetwork('http.get') });
Object.assign(https, { request: noNetwork('https.request'), get: noNetwork('https.get') });
Object.assign(net, { connect: noNetwork('net.connect'), createConnection: noNetwork('net.createConnection') });
Object.assign(tls, { connect: noNetwork('tls.connect') });
globalThis.fetch = noNetwork('fetch') as unknown as typeof fetch;
syncBuiltinESMExports();

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cfm-test-home-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
delete process.env.CONTENTFUL_MANAGEMENT_TOKEN;
delete process.env.CONTENTFUL_CONFIG_FILE;
process.chdir(home);
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
