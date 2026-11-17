/**
 * El núcleo sirve para cualquier herramienta (un CLI, una web, un backend), y eso se verifica
 * sobre el código fuente: no depende de Node, de una terminal ni de quien lo usa. Lo que necesita
 * disco va en src/node/, que se publica aparte como cmtool-core/node.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const file = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
  });

/** Un import: `from '…'`, `import('…')` o `import '…'`. */
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)'([^']+)'/g;

/** Desde dónde importa cada archivo: `archivo: módulo`. */
const imports = (files: string[]) =>
  files.flatMap((file) =>
    [...fs.readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => `${path.relative(ROOT, file)}: ${m[1]}`),
  );

const NODE_ONLY = [path.join(SRC, 'node'), path.join(SRC, 'node.ts')];
const coreFiles = sourceFiles(SRC);
const portableCore = coreFiles.filter((file) => !NODE_ONLY.some((only) => file.startsWith(only)));

describe('arquitectura del núcleo', () => {
  test('no usa Node (salvo src/node/), ni la terminal, ni colores', () => {
    const offenders = imports(portableCore).filter((line) => /: (node:|@clack\/|picocolors)/.test(line));
    assert.deepEqual(offenders, []);
  });

  test('no importa nada de quien lo usa (el CLI u otra herramienta)', () => {
    const offenders = imports(coreFiles).filter((line) => /: (cmtool-cli|backoffice-b2c)/.test(line));
    assert.deepEqual(offenders, []);
  });

  test('solo depende de contentful-management (y de sí mismo)', () => {
    const external = imports(portableCore).filter((line) => !/: (\.|contentful-management$)/.test(line));
    assert.deepEqual(external, []);
  });

  test('ningún import sale de src/: el paquete publicado es solo dist/', () => {
    const outside = coreFiles.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(IMPORT)]
        .filter((m) => m[1]?.startsWith('.') && !path.resolve(path.dirname(file), m[1]).startsWith(SRC))
        .map((m) => `${path.relative(ROOT, file)}: ${m[1]}`),
    );
    assert.deepEqual(outside, []);
  });
});
