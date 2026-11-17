import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { entryQueryParams, isEmptyQuery, parseSince } from '../src/core/query.ts';

describe('entryQueryParams', () => {
  test('siempre: las más recientes primero, sin archivadas y con límite', () => {
    assert.deepEqual(entryQueryParams({}, 50), {
      limit: 50,
      order: '-sys.updatedAt',
      'sys.archivedAt[exists]': false,
    });
  });

  test('cada filtro es un parámetro: todo se resuelve en una sola llamada', () => {
    const params = entryQueryParams(
      { text: 'Ramon', contentTypes: ['banner'], tag: 'navidad', since: '2026-10-01T05:00:00.000Z', updatedBy: 'u1' },
      50,
    );
    assert.equal(params.query, 'Ramon');
    assert.equal(params.content_type, 'banner');
    assert.equal(params['metadata.tags.sys.id[in]'], 'navidad');
    assert.equal(params['sys.updatedAt[gte]'], '2026-10-01T05:00:00.000Z');
    assert.equal(params['sys.updatedBy.sys.id'], 'u1');
  });

  test('varios content types se filtran por ID (content_type acepta uno solo)', () => {
    const params = entryQueryParams({ contentTypes: ['banner', 'slide'] }, 50);
    assert.equal(params.content_type, undefined);
    assert.equal(params['sys.contentType.sys.id[in]'], 'banner,slide');
  });

  test('isEmptyQuery', () => {
    assert.equal(isEmptyQuery({}), true);
    assert.equal(isEmptyQuery({ contentTypes: [] }), true);
    assert.equal(isEmptyQuery({ tag: 'x' }), false);
  });
});

describe('parseSince', () => {
  const now = new Date(2026, 9, 7, 15, 30); // 7 de octubre de 2026, 15:30 local

  test('hoy = desde la medianoche', () => {
    assert.equal(parseSince('hoy', now), new Date(2026, 9, 7).toISOString());
  });

  test('7d = hace 7 días', () => {
    assert.equal(parseSince('7d', now), new Date(now.getTime() - 7 * 86_400_000).toISOString());
  });

  test('una fecha AAAA-MM-DD', () => {
    assert.equal(parseSince('2026-10-01', now), new Date(2026, 9, 1).toISOString());
  });

  test('no entiende fechas imposibles ni otros textos', () => {
    for (const text of ['2026-02-30', '2026-13-01', 'ayer', '7', ''])
      assert.equal(parseSince(text, now), undefined, text);
  });
});
