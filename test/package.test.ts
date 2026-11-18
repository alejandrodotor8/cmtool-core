/**
 * Lo que se publica en npm. El paquete es público (ya no tiene "private"), así que este test
 * cuida que solo suba lo compilado, con su licencia: si alguien agrega src/ o test/ a "files",
 * o una entrada que apunta fuera de dist/, falla.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

describe('el paquete de npm', () => {
  test('publica solo dist/ y el CHANGELOG (npm agrega README, LICENSE y package.json)', () => {
    assert.deepEqual(pkg.files, ['dist', 'CHANGELOG.md']);
  });

  test('cada entrada (cmtool-core y cmtool-core/node) apunta a dist/', () => {
    const targets = Object.values(pkg.exports as Record<string, Record<string, string>>).flatMap(Object.values);
    assert.ok(targets.length > 0);
    for (const target of targets) assert.match(target, /^\.\/dist\//);
  });

  test('lleva licencia MIT, con su archivo LICENSE', () => {
    assert.equal(pkg.license, 'MIT');
    assert.match(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'), /^MIT License\n\nCopyright \(c\) \d{4} \S/);
  });
});
