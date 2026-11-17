import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ContentType } from '../src/contentful/types.ts';
import {
  compareRules,
  diffContentType,
  FIELD,
  fieldType,
  hasDifferences,
  withInfoOf,
  withRulesOf,
} from '../src/core/model.ts';
import { contentType, field } from './fixtures.ts';

describe('diffContentType', () => {
  const src = contentType('banner', [
    field('a'),
    field('b', 'Link', { linkType: 'Entry' }),
    field('c', 'Array', { items: { type: 'Link', linkType: 'Entry' } }),
  ]);
  const dst = contentType('banner', [field('a'), field('b', 'Link', { linkType: 'Asset' }), field('d')]);
  const diff = diffContentType(src, dst);

  test('clasifica cada campo y sigue el orden de origen, con los que sobran al final', () => {
    assert.deepEqual(
      diff.rows.map((r) => [r.field.id, r.status]),
      [
        ['a', FIELD.OK],
        ['b', FIELD.MISMATCH],
        ['c', FIELD.MISSING],
        ['d', FIELD.EXTRA],
      ],
    );
  });

  test('separa faltantes, sobrantes y de otro tipo', () => {
    assert.equal(diff.missingCT, false);
    assert.deepEqual(
      diff.missing.map((f) => f.id),
      ['c'],
    );
    assert.deepEqual(
      diff.extra.map((f) => f.id),
      ['d'],
    );
    assert.deepEqual(
      diff.mismatched.map((f) => f.id),
      ['b'],
    );
  });

  test('si el content type no existe en destino, todos sus campos faltan', () => {
    const missing = diffContentType(src, undefined);
    assert.equal(missing.missingCT, true);
    assert.ok(missing.rows.every((r) => r.status === FIELD.MISSING));
  });
});

describe('fieldType', () => {
  test('describe links y arrays', () => {
    assert.equal(fieldType(field('a')), 'Symbol');
    assert.equal(fieldType(field('b', 'Link', { linkType: 'Asset' })), 'Link Asset');
    assert.equal(fieldType(field('c', 'Array', { items: { type: 'Link', linkType: 'Entry' } })), 'Array<Entry>');
    assert.equal(fieldType(field('d', 'Array', { items: { type: 'Symbol' } })), 'Array<Symbol>');
  });
});

describe('compareRules', () => {
  test('campos iguales no tienen diferencias', () => {
    assert.equal(compareRules(field('a'), field('a')), undefined);
  });

  test('obligatorio en un solo ambiente, en cualquier dirección', () => {
    assert.equal(compareRules(field('a'), field('a', 'Symbol', { required: true }))?.requiredOnlyInDst, true);
    assert.equal(compareRules(field('a', 'Symbol', { required: true }), field('a'))?.requiredOnlyInSrc, true);
  });

  test('localizado en un solo ambiente, en cualquier dirección', () => {
    assert.equal(compareRules(field('a', 'Symbol', { localized: true }), field('a'))?.localizationLost, true);
    assert.equal(compareRules(field('a'), field('a', 'Symbol', { localized: true }))?.localizedOnlyInDst, true);
  });

  test('otro nombre visible', () => {
    assert.equal(compareRules(field('a', 'Symbol', { name: 'Título' }), field('a'))?.renamed, true);
  });

  test('validaciones distintas, incluidas las de los items de un Array', () => {
    const src = field('a', 'Array', {
      items: { type: 'Link', linkType: 'Entry', validations: [{ linkContentType: ['slide'] }] },
      validations: [{ size: { max: 5 } }],
    });
    const dst = field('a', 'Array', {
      items: { type: 'Link', linkType: 'Entry', validations: [{ linkContentType: ['slide', 'promo'] }] },
      validations: [{ size: { max: 5 } }],
    });
    assert.deepEqual(compareRules(src, dst)?.validations, ['items.linkContentType']);
  });

  test('ignora el orden de las listas y los mensajes de error', () => {
    const src = field('a', 'Symbol', { validations: [{ in: ['x', 'y'], message: 'uno' }] });
    const dst = field('a', 'Symbol', { validations: [{ in: ['y', 'x'], message: 'otro' }] });
    assert.equal(compareRules(src, dst), undefined);
  });

  test('una validación que solo existe en un lado cuenta como diferencia', () => {
    const dst = field('a', 'Symbol', { validations: [{ unique: true }] });
    assert.deepEqual(compareRules(field('a'), dst)?.validations, ['unique']);
  });
});

describe('diffContentType con reglas', () => {
  test('mismo tipo con reglas distintas queda como RULES, no como al día', () => {
    const diff = diffContentType(
      contentType('banner', [field('title')]),
      contentType('banner', [field('title', 'Symbol', { required: true })]),
    );
    assert.equal(diff.rows[0]?.status, FIELD.RULES);
    assert.deepEqual(
      diff.changedRules.map((f) => f.id),
      ['title'],
    );
  });
});

describe('withRulesOf', () => {
  test('copia nombre, obligatorio, localizado, validaciones, edición, API y valor por defecto; conserva ID y tipo', () => {
    const src = field('tags', 'Array', {
      name: 'Etiquetas',
      required: true,
      items: { type: 'Symbol', validations: [{ in: ['a', 'b'] }] },
      validations: [{ size: { max: 3 } }],
      omitted: true,
      defaultValue: { 'es-CO': ['a'] },
    });
    const dst = field('tags', 'Array', { items: { type: 'Symbol' }, disabled: true });
    assert.deepEqual(withRulesOf(dst, src), {
      id: 'tags',
      type: 'Array',
      name: 'Etiquetas',
      required: true,
      localized: false,
      validations: [{ size: { max: 3 } }],
      disabled: false,
      omitted: true,
      defaultValue: { 'es-CO': ['a'] },
      items: { type: 'Symbol', validations: [{ in: ['a', 'b'] }] },
    });
  });

  test('si origen no tiene valor por defecto, se quita el de destino', () => {
    const dst = field('a', 'Symbol', { defaultValue: { 'es-CO': 'x' } });
    assert.equal('defaultValue' in withRulesOf(dst, field('a')), false);
  });
});

describe('reglas: edición, API y valor por defecto', () => {
  test('detecta disabled, omitted y defaultValue distintos (undefined es igual a false)', () => {
    assert.equal(compareRules(field('a', 'Symbol', { disabled: false }), field('a')), undefined);
    assert.equal(compareRules(field('a', 'Symbol', { disabled: true }), field('a'))?.editingDiffers, true);
    assert.equal(compareRules(field('a'), field('a', 'Symbol', { omitted: true }))?.apiDiffers, true);
    assert.equal(
      compareRules(field('a', 'Symbol', { defaultValue: { 'es-CO': 'x' } }), field('a'))?.defaultValueDiffers,
      true,
    );
  });
});

describe('datos del content type', () => {
  const ct = (extra: Partial<ContentType>) => ({ ...contentType('banner', [field('title'), field('slug')]), ...extra });

  test('detecta nombre, descripción y campo de título distintos; vacío es igual a no tener', () => {
    const diff = diffContentType(
      ct({ name: 'Banner', description: '', displayField: 'slug' }),
      ct({ name: 'Banner viejo', description: undefined, displayField: 'title' }),
    );
    assert.deepEqual(diff.info, [
      { part: 'name', src: 'Banner', dst: 'Banner viejo' },
      { part: 'displayField', src: 'slug', dst: 'title' },
    ]);
    assert.equal(hasDifferences(diff), true);
  });

  test('withInfoOf solo cambia nombre, descripción y campo de título', () => {
    const dst = ct({ name: 'Viejo', displayField: 'title' });
    const result = withInfoOf(dst, ct({ name: 'Nuevo', description: 'Hero', displayField: 'slug' }));
    assert.deepEqual(result, { ...dst, name: 'Nuevo', description: 'Hero', displayField: 'slug' });
  });
});
