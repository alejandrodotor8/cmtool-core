import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Entry } from '../src/contentful/types.ts';
import {
  assetIdsOf,
  childEntryIds,
  collectLinks,
  hyperlinkedEntryIds,
  isArchived,
  makeTitleOf,
} from '../src/core/entries.ts';
import { contentType, entry, field, link } from './fixtures.ts';

describe('collectLinks', () => {
  test('encuentra links dentro de rich text', () => {
    const richText = {
      nodeType: 'document',
      content: [
        { nodeType: 'embedded-entry-block', data: { target: link('e1') } },
        { nodeType: 'paragraph', content: [{ data: { target: link('a1', 'Asset') } }] },
      ],
    };
    assert.deepEqual(collectLinks(richText), [
      { type: 'Entry', id: 'e1', hyperlink: false },
      { type: 'Asset', id: 'a1', hyperlink: false },
    ]);
  });

  test('marca los textos enlazados (hipervínculos) de un rich text', () => {
    const richText = {
      nodeType: 'document',
      content: [
        {
          nodeType: 'paragraph',
          content: [{ nodeType: 'entry-hyperlink', data: { target: link('pagina') }, content: [{ value: 'ver más' }] }],
        },
      ],
    };
    assert.deepEqual(collectLinks(richText), [{ type: 'Entry', id: 'pagina', hyperlink: true }]);
  });

  test('ignora objetos con sys que no son links', () => {
    assert.deepEqual(collectLinks({ sys: { type: 'Entry', id: 'x' } }), []);
  });
});

describe('childEntryIds / assetIdsOf', () => {
  const e = entry('e', 'banner', {
    a: { 'es-CO': link('x') },
    b: { 'es-CO': [link('x'), link('y')] },
    img: { 'es-CO': link('i1', 'Asset') },
  });

  test('hijos sin repetidos', () => {
    assert.deepEqual(childEntryIds(e), ['x', 'y']);
  });

  test('imágenes', () => {
    assert.deepEqual(assetIdsOf(e), ['i1']);
  });
});

describe('makeTitleOf', () => {
  const titleOf = makeTitleOf(new Map([['banner', contentType('banner', [field('title')])]]), 'es-CO');

  test('usa el displayField en el locale por defecto', () => {
    assert.equal(titleOf(entry('e', 'banner', { title: { 'es-CO': 'Hola', 'en-US': 'Hi' } })), 'Hola');
  });

  test('si no hay valor en ese locale, usa el primero que encuentre', () => {
    assert.equal(titleOf(entry('e', 'banner', { title: { 'en-US': 'Hi' } })), 'Hi');
  });

  test('sin título legible devuelve un texto fijo', () => {
    assert.equal(titleOf(entry('e', 'banner')), '(sin título)');
    assert.equal(titleOf(entry('e', 'banner', { title: { 'es-CO': 42 } })), '(sin título)');
    assert.equal(titleOf(entry('e', 'desconocido', { title: { 'es-CO': 'x' } })), '(sin título)');
  });
});

describe('hijos vs. textos enlazados', () => {
  const hyperlink = (id: string) => ({ nodeType: 'entry-hyperlink', data: { target: link(id) }, content: [] });
  const e = entry('banner', 'banner', {
    slide: { 'es-CO': link('slide') },
    body: {
      'es-CO': {
        nodeType: 'document',
        content: [
          { nodeType: 'embedded-entry-block', data: { target: link('promo') } },
          { nodeType: 'paragraph', content: [hyperlink('pagina'), hyperlink('slide')] },
          { nodeType: 'paragraph', content: [{ nodeType: 'asset-hyperlink', data: { target: link('pdf', 'Asset') } }] },
        ],
      },
    },
  });

  test('los componentes y las entries embebidas son hijos; los textos enlazados no', () => {
    assert.deepEqual(childEntryIds(e), ['slide', 'promo']);
  });

  test('los textos enlazados se listan aparte, sin repetir los que ya son hijos', () => {
    assert.deepEqual(hyperlinkedEntryIds(e), ['pagina']);
  });

  test('los archivos enlazados en texto sí cuentan como imágenes/archivos de la entry', () => {
    assert.deepEqual(assetIdsOf(e), ['pdf']);
  });
});

describe('isArchived', () => {
  test('detecta entries archivadas', () => {
    const archived = entry('a', 'x');
    (archived.sys as Entry['sys']).archivedVersion = 3;
    assert.equal(isArchived(archived), true);
    assert.equal(isArchived(entry('b', 'x')), false);
  });
});
