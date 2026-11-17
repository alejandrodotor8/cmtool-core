import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareEntryFields, migrationChanges, summarizeValue, TAGS, VALUE } from '../src/core/entry-compare.ts';
import { contentType, entry, field, link, locales } from './fixtures.ts';

describe('compareEntryFields', () => {
  const ct = contentType('banner', [field('title'), field('cta'), field('image', 'Link'), field('legal')]);
  const src = entry('b', 'banner', {
    title: { 'es-CO': 'Hola' },
    cta: { 'es-CO': 'Ver más' },
    image: { 'es-CO': link('img1', 'Asset') },
  });
  const dst = entry('b', 'banner', {
    title: { 'es-CO': 'Hola' },
    cta: { 'es-CO': 'Comprar' },
    legal: { 'es-CO': 'Términos' },
  });

  test('clasifica cada campo en el orden del modelo y omite los vacíos en ambos', () => {
    assert.deepEqual(
      compareEntryFields(src, dst, ct).map((f) => [f.id, f.status]),
      [
        ['title', VALUE.SAME],
        ['cta', VALUE.DIFFERENT],
        ['image', VALUE.ONLY_SRC],
        ['legal', VALUE.ONLY_DST],
      ],
    );
  });

  test('usa los nombres del modelo de origen', () => {
    assert.equal(
      compareEntryFields(src, dst, contentType('banner', [field('title', 'Symbol', { name: 'Título' })]))[0]?.name,
      'Título',
    );
  });

  test('los campos que no están en el modelo van al final', () => {
    const fields = compareEntryFields(entry('b', 'banner', { extra: { 'es-CO': 1 } }), entry('b', 'banner'), ct);
    assert.deepEqual(
      fields.map((f) => f.id),
      ['extra'],
    );
  });
});

describe('summarizeValue', () => {
  test('texto, números, links, listas y rich text', () => {
    assert.equal(summarizeValue({ 'es-CO': 'Hola' }), 'Hola');
    assert.equal(summarizeValue({ 'es-CO': 'Hola', 'en-US': 'Hi' }), 'Hola (+1 idiomas)');
    assert.equal(summarizeValue({ 'es-CO': 3 }), '3');
    assert.equal(summarizeValue({ 'es-CO': link('img1', 'Asset') }), '→ img1');
    assert.equal(summarizeValue({ 'es-CO': [link('a'), link('b')] }), '[2] → a, → b');
    assert.equal(
      summarizeValue({
        'es-CO': { nodeType: 'document', content: [{ nodeType: 'paragraph', content: [{ value: 'Texto largo' }] }] },
      }),
      'rich text: Texto largo',
    );
    assert.equal(summarizeValue(undefined), '—');
  });

  test('recorta textos largos', () => {
    assert.equal(summarizeValue('a'.repeat(100), 10), `${'a'.repeat(9)}…`);
  });
});

describe('migrationChanges', () => {
  const ct = contentType('banner', [field('title', 'Symbol', { localized: true }), field('cta')]);
  const es = locales(['es-CO']);
  const model = (dstCT = ct, loc = { src: es, dst: es }, srcCT = ct) => ({ srcCT, dstCT, locales: loc });
  const ids = (changes: { id: string }[]) => changes.map((f) => f.id);

  test('solo cuenta lo que la migración cambiaría: campos del modelo de origen, en sus idiomas', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', {
      title: { 'es-CO': 'Hola', 'pt-BR': 'Olá' },
      cta: { 'es-CO': 'Comprar' },
      soloDestino: { 'es-CO': 'x' },
    });
    assert.deepEqual(ids(migrationChanges(src, dst, model())), ['cta']);
  });

  test('sin cambios, lista vacía', () => {
    const same = entry('b', 'banner', { title: { 'es-CO': 'Hola' } });
    assert.deepEqual(migrationChanges(same, same, model()), []);
  });

  test('un campo vaciado en origen cuenta como cambio', () => {
    const src = entry('b', 'banner', {});
    const dst = entry('b', 'banner', { cta: { 'es-CO': 'Comprar' } });
    assert.deepEqual(
      migrationChanges(src, dst, model()).map((f) => [f.id, f.status]),
      [['cta', VALUE.ONLY_DST]],
    );
  });

  test('el orden de los idiomas o de las claves de un rich text no es un cambio', () => {
    const both = locales(['es-CO', 'en-US']);
    const rich = contentType('banner', [field('title', 'Symbol', { localized: true }), field('body', 'RichText')]);
    const src = entry('b', 'banner', {
      title: { 'es-CO': 'Hola', 'en-US': 'Hi' },
      body: { 'es-CO': { nodeType: 'document', data: {}, content: [] } },
    });
    const dst = entry('b', 'banner', {
      title: { 'en-US': 'Hi', 'es-CO': 'Hola' },
      body: { 'es-CO': { content: [], data: {}, nodeType: 'document' } },
    });
    assert.deepEqual(migrationChanges(src, dst, model(rich, { src: both, dst: both }, rich)), []);
  });

  test('un idioma que destino no tiene no es un cambio (no se puede escribir)', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola', 'en-US': 'Hi' } });
    const dst = entry('b', 'banner', { title: { 'es-CO': 'Hola' } });
    assert.deepEqual(migrationChanges(src, dst, model(ct, { src: locales(['es-CO', 'en-US']), dst: es })), []);
  });

  test('un campo con otro tipo en destino no es un cambio (nunca se escribe)', () => {
    const src = entry('b', 'banner', { cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', { cta: { 'es-CO': 3 } });
    const dstCT = contentType('banner', [field('title', 'Symbol', { localized: true }), field('cta', 'Integer')]);
    assert.deepEqual(migrationChanges(src, dst, model(dstCT)), []);
  });

  test('un campo que falta en el modelo de destino cuenta, marcado como nuevo', () => {
    const src = entry('b', 'banner', { cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', {});
    const dstCT = contentType('banner', [field('title', 'Symbol', { localized: true })]);
    assert.deepEqual(
      migrationChanges(src, dst, model(dstCT)).map((f) => [f.id, f.newField]),
      [['cta', true]],
    );
  });

  test('las traducciones de destino de un campo que en origen no está localizado se conservan', () => {
    const both = locales(['es-CO', 'en-US']);
    const dstCT = contentType('banner', [field('title', 'Symbol', { localized: true })]);
    const srcCT = contentType('banner', [field('title')]);
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' } });
    const dst = entry('b', 'banner', { title: { 'es-CO': 'Hola', 'en-US': 'Hi' } });
    assert.deepEqual(migrationChanges(src, dst, model(dstCT, { src: both, dst: both }, srcCT)), []);
  });

  test('tags de origen que faltan en destino cuentan; los que solo tiene destino no', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' } }, ['navidad']);
    const dst = entry('b', 'banner', { title: { 'es-CO': 'Hola' } }, ['solo-master']);
    const [tags] = migrationChanges(src, dst, model());
    assert.deepEqual([tags?.id, tags?.src], [TAGS, ['solo-master', 'navidad']]);
    assert.deepEqual(migrationChanges(dst, src, model()).length, 1);
    assert.deepEqual(migrationChanges(src, src, model()), []);
  });
});
