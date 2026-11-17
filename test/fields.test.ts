import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Field } from '../src/contentful/types.ts';
import { assetFieldsForDestination, fieldsForDestination, mergeTags, mergeWithExisting } from '../src/core/fields.ts';
import { asset, contentType, entry, field, locales } from './fixtures.ts';

const writableOf = (...fields: Field[]) => new Map(fields.map((f) => [f.id, f]));

describe('fieldsForDestination', () => {
  const source = entry('e1', 'banner', {
    title: { 'es-CO': 'Hola', 'en-US': 'Hi' },
    code: { 'es-CO': 'X1' },
    notInDst: { 'es-CO': 'no' },
  });

  test('solo copia campos escribibles y locales que existen en destino', () => {
    const writable = writableOf(field('title', 'Symbol', { localized: true }), field('code'));
    assert.deepEqual(fieldsForDestination(source, writable, locales(['es-CO'])), {
      title: { 'es-CO': 'Hola' },
      code: { 'es-CO': 'X1' },
    });
  });

  test('un campo no localizado solo lleva el locale por defecto de destino', () => {
    const writable = writableOf(field('title'));
    assert.deepEqual(fieldsForDestination(source, writable, locales(['es-CO', 'en-US'], 'en-US')), {
      title: { 'en-US': 'Hi' },
    });
  });

  test('omite el campo si no queda ningún valor', () => {
    const writable = writableOf(field('code'));
    assert.deepEqual(fieldsForDestination(source, writable, locales(['en-US'])), {});
  });
});

describe('mergeWithExisting', () => {
  const current = {
    title: { 'es-CO': 'Viejo', 'pt-BR': 'Velho' },
    onlyInDst: { 'es-CO': 'se conserva' },
    cleared: { 'es-CO': 'se borra' },
  };
  const merged = mergeWithExisting(
    current,
    { title: { 'es-CO': 'Nuevo' } },
    writableOf(field('title'), field('cleared')),
    { locales: locales(['es-CO', 'en-US']) },
  );

  test('en los campos que se migran manda el origen', () => {
    assert.equal(merged.title['es-CO'], 'Nuevo');
  });

  test('conserva los locales que solo existen en destino', () => {
    assert.equal(merged.title['pt-BR'], 'Velho');
  });

  test('conserva los campos que no se migran', () => {
    assert.deepEqual(merged.onlyInDst, { 'es-CO': 'se conserva' });
  });

  test('si el campo quedó vacío en origen, se vacía en destino', () => {
    assert.equal('cleared' in merged, false);
  });

  test('no modifica el objeto original', () => {
    assert.equal(current.title['es-CO'], 'Viejo');
  });

  test('conserva las traducciones de destino de un campo que en origen no está localizado', () => {
    const result = mergeWithExisting(
      { title: { 'es-CO': 'Viejo', 'en-US': 'Old' } },
      { title: { 'es-CO': 'Nuevo' } },
      writableOf(field('title', 'Symbol', { localized: true })),
      { locales: locales(['es-CO', 'en-US']), ct: contentType('banner', [field('title')]) },
    );
    assert.deepEqual(result.title, { 'es-CO': 'Nuevo', 'en-US': 'Old' });
  });
});

describe('fieldsForDestination con idiomas por defecto distintos', () => {
  test('el único valor de un campo no localizado pasa al idioma por defecto de destino', () => {
    const source = entry('e1', 'banner', { code: { 'en-US': 'X1' } });
    const result = fieldsForDestination(source, writableOf(field('code')), locales(['es-CO']), {
      locales: locales(['en-US']),
      ct: contentType('banner', [field('code')]),
    });
    assert.deepEqual(result, { code: { 'es-CO': 'X1' } });
  });

  test('de un campo localizado en origen no se toma otro idioma', () => {
    const source = entry('e1', 'banner', { code: { 'en-US': 'Hi' } });
    const result = fieldsForDestination(source, writableOf(field('code')), locales(['es-CO']), {
      locales: locales(['en-US', 'es-CO'], 'en-US'),
      ct: contentType('banner', [field('code', 'Symbol', { localized: true })]),
    });
    assert.deepEqual(result, {});
  });
});

describe('mergeTags', () => {
  test('agrega los tags de origen y nunca quita los de destino', () => {
    const tagLink = (id: string) => ({ sys: { type: 'Link', linkType: 'Tag', id } }) as const;
    assert.deepEqual(
      mergeTags([tagLink('solo-master'), tagLink('navidad')], [tagLink('navidad'), tagLink('promo')]).map(
        (t) => t.sys.id,
      ),
      ['solo-master', 'navidad', 'promo'],
    );
  });
});

describe('assetFieldsForDestination', () => {
  test('usa https y solo los locales de destino', () => {
    const source = asset(
      'img1',
      { 'es-CO': { url: '//images.ctfassets.net/s/img1.jpg' }, 'fr-FR': { url: '//images.ctfassets.net/s/fr.jpg' } },
      { 'es-CO': 'Foto' },
    );
    const fields = assetFieldsForDestination(source, locales(['es-CO']));
    assert.deepEqual(Object.keys(fields.file), ['es-CO']);
    assert.equal(fields.file['es-CO']?.upload, 'https://images.ctfassets.net/s/img1.jpg');
    assert.deepEqual(fields.title, { 'es-CO': 'Foto' });
  });

  test('si el asset no tiene título, no envía título', () => {
    const fields = assetFieldsForDestination(
      asset('img1', { 'es-CO': { url: '//images.ctfassets.net/a.jpg' } }),
      locales(['es-CO']),
    );
    assert.equal('title' in fields, false);
  });

  for (const url of [
    'https://evil.example.com/a.jpg',
    'http://images.ctfassets.net/a.jpg',
    'https://ctfassets.net.evil.com/a.jpg',
    'https://evilctfassets.net/a.jpg',
    'no-es-una-url',
  ]) {
    test(`rechaza archivos fuera del CDN de Contentful: ${url}`, () => {
      assert.throws(
        () => assetFieldsForDestination(asset('img1', { 'es-CO': { url } }), locales(['es-CO'])),
        /CDN de Contentful/,
      );
    });
  }
});
