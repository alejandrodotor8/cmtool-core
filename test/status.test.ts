import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareModels, hasDifferences } from '../src/core/model.ts';
import { environmentStatus } from '../src/core/status.ts';
import { contentType, field, locales } from './fixtures.ts';

const srcCTs = new Map([
  ['banner', contentType('banner', [field('title'), field('cta')])],
  ['slide', contentType('slide', [field('title')])],
  ['promo', contentType('promo', [field('title')])],
]);
const dstCTs = new Map([
  ['banner', contentType('banner', [field('title')])],
  ['slide', contentType('slide', [field('title')])],
  ['legacy', contentType('legacy', [field('title')])],
]);

describe('compareModels', () => {
  test('compara todos los content types, ordenados por nombre, y lista los que solo están en destino', () => {
    const { diffs, onlyInDst } = compareModels(srcCTs, dstCTs);
    assert.deepEqual(
      diffs.map((d) => [d.id, hasDifferences(d)]),
      [
        ['banner', true],
        ['promo', true],
        ['slide', false],
      ],
    );
    assert.deepEqual(
      onlyInDst.map((ct) => ct.sys.id),
      ['legacy'],
    );
  });

  test('con IDs, solo esos', () => {
    const { diffs, onlyInDst } = compareModels(srcCTs, dstCTs, ['slide', 'legacy']);
    assert.deepEqual(
      diffs.map((d) => d.id),
      ['slide'],
    );
    assert.deepEqual(
      onlyInDst.map((ct) => ct.sys.id),
      ['legacy'],
    );
  });
});

describe('environmentStatus', () => {
  test('agrupa content types, idiomas y tags por diferencia', () => {
    const status = environmentStatus(
      compareModels(srcCTs, dstCTs),
      { src: locales(['es-CO', 'en-US']), dst: locales(['es-CO', 'pt-BR']) },
      { src: new Set(['navidad', 'promo']), dst: new Set(['promo', 'viejo']) },
    );
    assert.deepEqual(
      status.contentTypes.same.map((d) => d.id),
      ['slide'],
    );
    assert.deepEqual(
      status.contentTypes.different.map((d) => d.id),
      ['banner'],
    );
    assert.deepEqual(
      status.contentTypes.missingInDst.map((d) => d.id),
      ['promo'],
    );
    assert.deepEqual(status.contentTypes.onlyInDst, ['legacy']);
    assert.deepEqual(status.locales, { missingInDst: ['en-US'], onlyInDst: ['pt-BR'] });
    assert.deepEqual(status.tags, { missingInDst: ['navidad'], onlyInDst: ['viejo'] });
  });
});
