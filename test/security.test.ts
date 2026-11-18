/**
 * Garantías que se verifican sobre el código fuente: si alguien agrega una escritura
 * fuera del writer, o una forma de borrar, este test falla.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

const ROOT = path.join(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');
const WRITER = path.join(SRC, 'contentful/write.ts');

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const file = path.join(dir, d.name);
    return d.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
  });

/** Llamadas del CMA que escriben. */
const WRITE_CALL = /\.(create|createWithId|update|publish|unpublish|delete|archive|unarchive|processForAllLocales)\(/;

describe('seguridad del código', () => {
  test('solo el writer (contentful/write.ts) llama métodos del CMA que escriben', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== WRITER)
      .flatMap((file) =>
        fs
          .readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ file, line, n: i + 1 }))
          .filter(({ line }) => WRITE_CALL.test(line) && !line.trim().startsWith('*') && !line.trim().startsWith('//')),
      )
      .map(({ file, n, line }) => `${path.relative(ROOT, file)}:${n}: ${line.trim()}`);
    assert.deepEqual(offenders, []);
  });

  test('solo las migraciones (src/migrations/) crean un writer, siempre atado a su destino', () => {
    const MIGRATIONS = path.join(SRC, 'migrations');
    const creators = sourceFiles(SRC)
      .filter((file) => file !== WRITER && /\bcreateWriter\(/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file));
    assert.ok(creators.length > 0);
    assert.deepEqual(
      creators.filter((file) => !path.join(ROOT, file).startsWith(MIGRATIONS)),
      [],
    );
  });

  test('el writer no tiene forma de borrar, archivar ni despublicar', () => {
    const code = fs.readFileSync(WRITER, 'utf8');
    assert.doesNotMatch(code, /\.(delete|archive|unarchive|unpublish)\(/);
  });

  test('el writer solo publica content types', () => {
    const publishes = [...fs.readFileSync(WRITER, 'utf8').matchAll(/cma\.(\w+)\.publish\(/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(publishes)], ['contentType']);
  });
});
