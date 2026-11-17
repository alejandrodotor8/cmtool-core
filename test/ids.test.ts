import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseEntryIds, parseIds } from '../src/core/ids.ts';

const ids = (text: string) => parseEntryIds(text).ids;

describe('parseEntryIds', () => {
  test('separa por coma, espacio o salto de línea', () => {
    assert.deepEqual(ids('abc, def ghi\njkl'), ['abc', 'def', 'ghi', 'jkl']);
  });

  test('acepta una columna pegada de Excel (saltos de línea de Windows y línea final vacía)', () => {
    assert.deepEqual(ids('5NIY0nRGNkKvvjO8yc8Pp1\r\n1Y57gyOW6qHDUgTTL829aC\r\n3IpBpsS78SFJI1ya0iBp8M\r\n'), [
      '5NIY0nRGNkKvvjO8yc8Pp1',
      '1Y57gyOW6qHDUgTTL829aC',
      '3IpBpsS78SFJI1ya0iBp8M',
    ]);
  });

  test('acepta una fila pegada de Excel (tabulaciones) y punto y coma', () => {
    assert.deepEqual(ids('a\tb\tc'), ['a', 'b', 'c']);
    assert.deepEqual(ids('a;b; c'), ['a', 'b', 'c']);
  });

  test('quita comillas alrededor del ID', () => {
    assert.deepEqual(ids('"a", \'b\''), ['a', 'b']);
  });

  test('extrae el ID de la URL de una entry', () => {
    const url =
      'https://app.contentful.com/spaces/s1/environments/develop/entries/5NIY0nRGNkKvvjO8yc8Pp1?focusedField=x';
    assert.deepEqual(ids(url), ['5NIY0nRGNkKvvjO8yc8Pp1']);
    assert.deepEqual(ids('https://app.contentful.com/spaces/s1/entries/abc/'), ['abc']);
  });

  test('quita repetidos y vacíos', () => {
    assert.deepEqual(ids('a a,a'), ['a']);
    assert.deepEqual(ids('  ,  \n\n'), []);
  });

  test('separa lo que no es un entry ID ni la URL de una entry', () => {
    const result = parseEntryIds(
      'abc https://app.contentful.com/spaces/s1/assets/img1 https://app.contentful.com/spaces/s1/entries/ hola!',
    );
    assert.deepEqual(result.ids, ['abc']);
    assert.deepEqual(result.invalid, [
      'https://app.contentful.com/spaces/s1/assets/img1',
      'https://app.contentful.com/spaces/s1/entries/',
      'hola!',
    ]);
  });

  test('un ID de más de 64 caracteres no es válido', () => {
    assert.deepEqual(parseEntryIds('a'.repeat(65)).invalid, ['a'.repeat(65)]);
  });
});

describe('parseIds para assets', () => {
  test('extrae el ID de la URL de un asset y rechaza URLs de entries', () => {
    const result = parseIds(
      'https://app.contentful.com/spaces/s1/environments/develop/assets/img1 https://app.contentful.com/spaces/s1/entries/e1 img2',
      'assets',
    );
    assert.deepEqual(result.ids, ['img1', 'img2']);
    assert.deepEqual(result.invalid, ['https://app.contentful.com/spaces/s1/entries/e1']);
  });
});
