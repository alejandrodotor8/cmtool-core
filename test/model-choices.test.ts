/** Los cambios de modelo que se pueden elegir: preguntar, recibirlos por flag y repetirlos. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { diffContentType } from '../src/core/model.ts';
import { CHANGE } from '../src/core/model-changes.ts';
import { modelChoices } from '../src/core/model-choices.ts';
import { contentType, field } from './fixtures.ts';

const diff = diffContentType(
  contentType('banner', [field('title'), field('subtitle'), field('cta')]),
  contentType('banner', [field('title')]),
);

describe('modelChoices', () => {
  const choices = modelChoices([diff]);

  test('ofrece agregar los campos que faltan', () => {
    assert.deepEqual(
      choices.all.map((pick) => pick.kind === CHANGE.ADD && pick.field.id),
      ['subtitle', 'cta'],
    );
    assert.equal(choices.options.length, 1);
  });

  test('escribe la elección como el flag --model: todo, nada o la lista', () => {
    assert.equal(choices.decisionFor(choices.all), 'all');
    assert.equal(choices.decisionFor([]), 'none');
    assert.deepEqual(choices.decisionFor(choices.all.slice(1)), ['add:banner.cta']);
  });

  test('aplica una decisión del flag y avisa lo que ya no está disponible', () => {
    assert.equal(choices.apply('all').picked.length, 2);
    assert.deepEqual(choices.apply('none'), { picked: [], unknown: [] });
    const { picked, unknown } = choices.apply(['add:banner.subtitle', 'add:banner.otro']);
    assert.deepEqual(
      picked.map((pick) => pick.kind === CHANGE.ADD && pick.field.id),
      ['subtitle'],
    );
    assert.deepEqual(unknown, ['add:banner.otro']);
  });

  test('con `written`, un content type que falta solo se ofrece si se escribe algo de él', () => {
    const missing = diffContentType(contentType('promo', [field('title')]), undefined);
    assert.equal(modelChoices([missing], { written: new Set() }).all.length, 0);
    assert.equal(modelChoices([missing], { written: new Set(['promo']) }).all.length, 1);
  });
});
