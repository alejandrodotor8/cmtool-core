import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EditorFieldDiff } from '../src/core/editor.ts';
import { diffContentType } from '../src/core/model.ts';
import {
  allPicks,
  CHANGE,
  changesStructure,
  countEditorFields,
  countNewFields,
  countRuleFields,
  hasModelChanges,
  modelChangesFrom,
  modelOptions,
  notAddedFields,
  pickKey,
} from '../src/core/model-changes.ts';
import { contentType, field } from './fixtures.ts';

const helpText = (fieldId: string): EditorFieldDiff => ({
  fieldId,
  parts: ['helpText'],
  helpText: { src: 'Ayuda' },
  widget: {},
  settings: [],
});

const subtitle = field('subtitle');
const cta = field('cta');
const banner = diffContentType(
  contentType('banner', [field('title'), subtitle, cta]),
  contentType('banner', [field('title')]),
);
const promoCT = contentType('promo', [field('title')]);
const promo = diffContentType(promoCT, undefined);
const slide = diffContentType(contentType('slide', [field('title')]), contentType('slide', [field('title')]));

describe('modelOptions', () => {
  test('sin entries de por medio (migrar modelo): ofrece lo que falta, nada más', () => {
    assert.deepEqual(
      modelOptions([banner, promo, slide]).map((o) => [o.diff.id, o.onlyReused]),
      [
        ['banner', false],
        ['promo', false],
      ],
    );
  });

  test('con entries: un content type que falta solo se ofrece si se escribe alguna entry suya', () => {
    const options = modelOptions([banner, promo], new Set(['banner']));
    assert.deepEqual(
      options.map((o) => o.diff.id),
      ['banner'],
    );
  });

  test('marca los campos de content types que solo usan entries reutilizadas', () => {
    assert.equal(modelOptions([banner], new Set())[0]?.onlyReused, true);
  });
});

describe('modelChangesFrom y notAddedFields', () => {
  const changes = modelChangesFrom(
    [
      { kind: 'add', ctId: 'banner', field: subtitle },
      { kind: 'create', ctId: 'promo' },
    ],
    new Map([['promo', promoCT]]),
  );

  test('agrupa campos por content type y arma los content types a crear', () => {
    assert.deepEqual(
      changes.fieldsToAdd.get('banner')?.map((f) => f.id),
      ['subtitle'],
    );
    assert.deepEqual(
      changes.contentTypesToCreate.map((ct) => ct.sys.id),
      ['promo'],
    );
    assert.equal(countNewFields(changes), 1);
    assert.equal(hasModelChanges(changes), true);
  });

  test('lista los campos que faltan y no se marcaron', () => {
    assert.deepEqual(notAddedFields([banner, promo], changes.fieldsToAdd), ['banner.cta']);
  });

  test('sin nada marcado, no hay cambios', () => {
    assert.equal(hasModelChanges(modelChangesFrom([], new Map())), false);
  });
});

describe('apariencia del editor en los cambios de modelo', () => {
  test('al crear un content type o agregar campos, se copia su apariencia', () => {
    const changes = modelChangesFrom(
      [
        { kind: 'add', ctId: 'banner', field: subtitle },
        { kind: 'create', ctId: 'promo' },
      ],
      new Map([['promo', promoCT]]),
    );
    assert.deepEqual(
      [...changes.editorFields].map(([ct, ids]) => [ct, [...ids]]),
      [
        ['banner', ['subtitle']],
        ['promo', ['title']],
      ],
    );
  });

  test('copiar la apariencia de un campo no crea el content type ni publica el modelo', () => {
    const changes = modelChangesFrom([{ kind: CHANGE.EDITOR, ctId: 'slide', editor: helpText('title') }], new Map());
    assert.deepEqual(changes.contentTypesToCreate, []);
    assert.deepEqual([...(changes.editorFields.get('slide') ?? [])], ['title']);
    assert.equal(countEditorFields(changes), 1);
    assert.equal(hasModelChanges(changes), true);
    assert.equal(changesStructure(changes), false);
  });
});

describe('modelOptions: un cambio por cosa', () => {
  const page = diffContentType(
    contentType('page', [field('title', 'Symbol', { name: 'Título' }), field('slug'), field('body', 'Text')]),
    contentType('page', [field('title'), field('slug')]),
  );

  test('cada campo que falta, cada regla distinta y cada apariencia distinta es una opción aparte', () => {
    const [option] = modelOptions([page], undefined, new Map([['page', [helpText('slug')]]]));
    assert.deepEqual(
      option?.picks.map((p) => [p.kind, 'field' in p ? p.field.id : 'editor' in p ? p.editor.fieldId : p.ctId]),
      [
        [CHANGE.RULES, 'title'],
        [CHANGE.EDITOR, 'slug'],
        [CHANGE.ADD, 'body'],
      ],
    );
  });

  test('ofrece content types que solo difieren en apariencia', () => {
    const options = modelOptions([slide], undefined, new Map([['slide', [helpText('title')]]]));
    assert.deepEqual(
      options.map((o) => [o.diff.id, o.picks.map((p) => p.kind)]),
      [['slide', [CHANGE.EDITOR]]],
    );
  });

  test('"todo" son todos los cambios de todas las opciones', () => {
    const options = modelOptions([page, promo], undefined, new Map([['page', [helpText('slug')]]]));
    assert.equal(allPicks(options).length, 4);
  });

  test('las reglas marcadas se agrupan por content type y publican el modelo', () => {
    const [option] = modelOptions([page]);
    const changes = modelChangesFrom(option?.picks.filter((p) => p.kind === CHANGE.RULES) ?? [], new Map());
    assert.deepEqual(
      changes.rulesToUpdate.get('page')?.map((f) => f.name),
      ['Título'],
    );
    assert.equal(countRuleFields(changes), 1);
    assert.equal(changesStructure(changes), true);
  });
});

describe('pickKey', () => {
  test('cada cambio tiene una clave estable para --model', () => {
    const [option] = modelOptions(
      [
        diffContentType(
          contentType('page', [field('title', 'Symbol', { name: 'Título' }), field('slug'), field('body', 'Text')]),
          contentType('page', [field('title'), field('slug')]),
        ),
      ],
      undefined,
      new Map([['page', [helpText('slug')]]]),
    );
    assert.deepEqual(option?.picks.map(pickKey), ['rules:page.title', 'editor:page.slug', 'add:page.body']);
    assert.equal(pickKey({ kind: CHANGE.CREATE, ctId: 'promo' }), 'create:promo');
  });
});
