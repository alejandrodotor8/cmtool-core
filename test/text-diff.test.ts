import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { summarizeValue } from '../src/core/entry-compare.ts';
import { diffFieldValues, diffText, TEXT, type TextPart, valueText } from '../src/core/text-diff.ts';
import { link } from './fixtures.ts';

const text = (value: string) => ({ nodeType: 'text', value, marks: [], data: {} });
const block = (nodeType: string, ...content: object[]) => ({ nodeType, data: {}, content });
const doc = (...content: object[]) => block('document', ...content);

/** Lo que se ve de cada lado: lo igual más lo quitado (antes) o lo agregado (después). */
const sides = (parts: TextPart[]) => ({
  before: parts
    .filter((p) => p.kind !== TEXT.ADDED)
    .map((p) => p.text)
    .join(''),
  after: parts
    .filter((p) => p.kind !== TEXT.REMOVED)
    .map((p) => p.text)
    .join(''),
});
const show = (parts: TextPart[]) =>
  parts
    .map((p) => (p.kind === TEXT.SAME ? p.text : p.kind === TEXT.REMOVED ? `[-${p.text}-]` : `{+${p.text}+}`))
    .join('');

describe('valueText: el texto completo, sin recortar', () => {
  test('texto tal cual (con sus saltos), números, listas y links', () => {
    assert.equal(valueText('Línea 1\nLínea 2'), 'Línea 1\nLínea 2');
    assert.equal(valueText(3), '3');
    assert.equal(valueText(['a', 'b']), 'a, b');
    assert.equal(valueText([link('a'), link('b')]), '→ a, → b');
    assert.equal(valueText(undefined), '');
  });

  test('un rich text: un bloque por línea, sin partir palabras con formato', () => {
    const richText = doc(
      block('heading-2', text('Título')),
      block('paragraph', text('Hola '), text('mun'), text('do')),
      block('unordered-list', block('list-item', block('paragraph', text('uno')))),
      { nodeType: 'embedded-entry-block', data: { target: link('banner') }, content: [] },
    );
    assert.equal(valueText(richText), 'Título\nHola mundo\n• uno\n[→ banner]');
    assert.equal(summarizeValue({ 'es-CO': richText }, 100), 'rich text: Título Hola mundo • uno [→ banner]');
  });

  test('un valor por idioma: cada idioma en su línea', () => {
    assert.equal(valueText({ 'es-CO': 'Hola', 'en-US': 'Hi' }), 'es-CO: Hola\nen-US: Hi');
  });
});

describe('diffText: qué cambia, palabra por palabra', () => {
  const cases: [string, string, string][] = [
    ['Compra ya en la tienda', 'Compra hoy en la tienda', 'Compra [-ya-]{+hoy+} en la tienda'],
    ['Hola mundo', 'Hola mundo cruel', 'Hola mundo{+ cruel+}'],
    ['Hola mundo cruel', 'Hola mundo', 'Hola mundo[- cruel-]'],
    ['Hola mundo', 'Adiós amigo', '[-Hola mundo-]{+Adiós amigo+}'],
    ['', 'Nuevo', '{+Nuevo+}'],
    ['Viejo', '', '[-Viejo-]'],
    ['Igual', 'Igual', 'Igual'],
    ['envío gratis.', 'envío gratis!', 'envío gratis[-.-]{+!+}'],
  ];
  for (const [before, after, expected] of cases) {
    test(`${JSON.stringify(before)} → ${JSON.stringify(after)}`, () => {
      const parts = diffText(before, after);
      assert.equal(show(parts), expected);
      assert.deepEqual(sides(parts), { before, after });
    });
  }

  test('un texto largo con un cambio en el medio: solo se marca lo que cambió', () => {
    const words = Array.from({ length: 300 }, (_, i) => `palabra${i}`);
    const before = words.join(' ');
    const after = words.map((w, i) => (i === 150 ? 'CAMBIO' : w)).join(' ');
    const parts = diffText(before, after);
    assert.deepEqual(
      parts.filter((p) => p.kind !== TEXT.SAME),
      [
        { kind: TEXT.REMOVED, text: 'palabra150' },
        { kind: TEXT.ADDED, text: 'CAMBIO' },
      ],
    );
    assert.deepEqual(sides(parts), { before, after });
  });

  test('si los dos lados son enormes y distintos, el tramo se marca entero (y sigue cuadrando)', () => {
    const before = Array.from({ length: 1100 }, (_, i) => `a${i}`).join(' ');
    const after = Array.from({ length: 1100 }, (_, i) => `b${i}`).join(' ');
    const parts = diffText(before, after);
    assert.deepEqual(
      parts.map((p) => p.kind),
      [TEXT.REMOVED, TEXT.ADDED],
    );
    assert.deepEqual(sides(parts), { before, after });
  });
});

describe('diffFieldValues: idioma por idioma', () => {
  test('cada idioma por separado, con lo que cambió en cada uno', () => {
    const diffs = diffFieldValues({ 'es-CO': 'Hola', 'en-US': 'Hi' }, { 'es-CO': 'Hola', 'en-US': 'Hello' });
    assert.deepEqual(
      diffs.map((d) => [d.locale, d.changed]),
      [
        ['es-CO', false],
        ['en-US', true],
      ],
    );
    assert.equal(show(diffs[1]?.parts ?? []), '[-Hi-]{+Hello+}');
  });

  test('un lado vacío: lo del otro llega o se va entero', () => {
    const [filled] = diffFieldValues(undefined, { 'es-CO': 'Nuevo' });
    assert.deepEqual([filled?.before, filled?.after, filled?.changed], [undefined, 'Nuevo', true]);
    const [emptied] = diffFieldValues({ 'es-CO': 'Viejo' }, undefined);
    assert.deepEqual([emptied?.before, emptied?.after], ['Viejo', undefined]);
  });

  test('un valor que no va por idioma (los tags) es uno solo', () => {
    const [tags] = diffFieldValues(['promo'], ['promo', 'home']);
    assert.equal(tags?.locale, undefined);
    assert.equal(show(tags?.parts ?? []), 'promo{+, home+}');
  });
});
