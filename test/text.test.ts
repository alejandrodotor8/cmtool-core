import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EditorFieldDiff } from '../src/core/editor.ts';
import { compareModels, diffContentType, FIELD } from '../src/core/model.ts';
import {
  contentTypeStatusParts,
  editorDiffText,
  fieldStatusText,
  modelPicksSummary,
  ruleUpdateText,
} from '../src/text.ts';
import { contentType, field } from './fixtures.ts';

const helpTextDiff = (fieldId: string, dst?: string): EditorFieldDiff => ({
  fieldId,
  parts: ['helpText'],
  helpText: { src: 'Usa una imagen de 1200×600', dst },
  widget: {},
  settings: [],
});

describe('modelPicksSummary', () => {
  test('cuenta cada tipo de cambio', () => {
    assert.equal(
      modelPicksSummary([{ kind: 'create' }, { kind: 'add' }, { kind: 'add' }, { kind: 'rules' }, { kind: 'editor' }]),
      '1 content type(s) nuevo(s) · 2 campo(s) nuevo(s) · reglas de 1 campo(s) · apariencia de 1 campo(s)',
    );
  });
});

describe('ruleUpdateText', () => {
  test('dice qué cambia en destino y avisa lo que puede afectar el contenido', () => {
    const [row] = diffContentType(
      contentType('page', [field('title', 'Symbol', { name: 'Título', required: true })]),
      contentType('page', [field('title', 'Symbol', { localized: true })]),
    ).rows;
    assert.ok(row);
    assert.equal(
      ruleUpdateText(row),
      'nombre: «title» → «Título» · obligatorio: no → sí · localizado: sí → no · ' +
        '⚠ las entries con este campo vacío no se podrán publicar · ⚠ se pierden los valores de los otros idiomas',
    );
  });
});

describe('apariencia del editor en el estado del modelo', () => {
  const [banner] = compareModels(
    new Map([['banner', contentType('banner', [field('title')])]]),
    new Map([['banner', contentType('banner', [field('title')])]]),
  ).diffs;

  test('un content type igual pero con otra apariencia no queda "al día"', () => {
    assert.ok(banner);
    assert.deepEqual(contentTypeStatusParts(banner, 'qa'), []);
    assert.deepEqual(contentTypeStatusParts(banner, 'qa', 1), ['1 con otra apariencia']);
  });

  test('el campo dice exactamente qué difiere', () => {
    const row = banner?.rows[0];
    assert.ok(row);
    assert.equal(row.status, FIELD.OK);
    assert.equal(fieldStatusText(row, 'qa', 'es-CO'), 'al día');
    assert.equal(fieldStatusText(row, 'qa', 'es-CO', helpTextDiff('title')), 'help text falta en qa');
    assert.equal(editorDiffText(helpTextDiff('title', 'Otra ayuda'), 'qa'), 'help text distinto (en qa: «Otra ayuda»)');
    assert.equal(
      editorDiffText(
        { fieldId: 'b', parts: ['widget'], helpText: {}, widget: { src: 'dropdown', dst: 'singleLine' }, settings: [] },
        'qa',
      ),
      'widget «Dropdown» (en qa: «Single line»)',
    );
  });

  test('nombra el widget y cada ajuste como en la pantalla de Contentful', () => {
    assert.equal(
      editorDiffText(
        {
          fieldId: 'ref',
          parts: ['widget', 'settings'],
          helpText: {},
          widget: { src: 'entryCardsEditor', dst: 'entryLinksEditor' },
          settings: [{ key: 'showCreateEntityAction', src: false, dst: true }],
        },
        'master',
      ),
      'widget «Entry cards» (en master: «Entry links») · Show "Create new entries": no (en master: sí)',
    );
  });
});
