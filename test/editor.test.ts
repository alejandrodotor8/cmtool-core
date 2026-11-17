import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { EditorControl, EditorInterface } from '../src/contentful/types.ts';
import { editorDifferences, editorDiffsFor, mergeControls, portableControl } from '../src/core/editor.ts';
import { diffContentType } from '../src/core/model.ts';
import { contentType, field } from './fixtures.ts';

const editor = (controls: EditorControl[]) => ({ controls }) as unknown as EditorInterface;
const builtin = (fieldId: string, helpText?: string, widgetId = 'singleLine'): EditorControl => ({
  fieldId,
  widgetId,
  widgetNamespace: 'builtin',
  ...(helpText !== undefined && { settings: { helpText } }),
});
const ids = (diffs: { fieldId: string }[]) => diffs.map((d) => d.fieldId);

describe('portableControl', () => {
  test('un widget de Contentful se copia con sus ajustes (incluido el help text)', () => {
    assert.deepEqual(portableControl(builtin('alt', 'Texto alternativo')), builtin('alt', 'Texto alternativo'));
  });

  test('de un widget de app o extensión solo se copia el help text', () => {
    const appControl: EditorControl = {
      fieldId: 'color',
      widgetId: 'app-123',
      widgetNamespace: 'app',
      settings: { helpText: 'Color de fondo', paleta: 'marca' },
    };
    assert.deepEqual(portableControl(appControl), { fieldId: 'color', settings: { helpText: 'Color de fondo' } });
    assert.deepEqual(portableControl({ fieldId: 'x', widgetId: 'app-1', widgetNamespace: 'app' }), { fieldId: 'x' });
  });
});

describe('editorDifferences', () => {
  test('detecta help text distinto, widget distinto o control faltante en destino', () => {
    const src = editor([
      builtin('a', 'Ayuda'),
      builtin('b', undefined, 'markdown'),
      builtin('c', 'Igual'),
      builtin('d', 'Nuevo'),
    ]);
    const dst = editor([builtin('a'), builtin('b'), builtin('c', 'Igual')]);
    const diffs = editorDifferences(
      src,
      dst,
      ['a', 'b', 'c', 'd'].map((id) => field(id)),
    );
    assert.deepEqual(
      diffs.map((d) => [d.fieldId, d.parts]),
      [
        ['a', ['helpText']],
        ['b', ['widget']],
        ['d', ['helpText']],
      ],
    );
    assert.deepEqual(diffs[0]?.helpText, { src: 'Ayuda', dst: undefined });
    assert.deepEqual(diffs[1]?.widget, { src: 'markdown', dst: 'singleLine' });
  });

  test('solo cambió el help text de un campo: los demás no cuentan como distintos', () => {
    // Lo que se ve igual en Contentful: ajustes vacíos, help text vacío y el widget por
    // defecto escrito en un ambiente y omitido en el otro.
    const src = editor([
      { fieldId: 'nombre', widgetId: 'singleLine', widgetNamespace: 'builtin', settings: {} },
      builtin('imagen', 'Usa una imagen de 1200×600', 'assetLinkEditor'),
      { fieldId: 'descripcion', widgetId: 'richTextEditor', widgetNamespace: 'builtin', settings: { helpText: '' } },
    ]);
    const dst = editor([
      { fieldId: 'nombre', widgetId: 'singleLine', widgetNamespace: 'builtin' },
      { fieldId: 'imagen', widgetId: 'assetLinkEditor', widgetNamespace: 'builtin' },
      { fieldId: 'descripcion' },
    ]);
    const fields = [field('nombre'), field('imagen', 'Link', { linkType: 'Asset' }), field('descripcion', 'RichText')];
    assert.deepEqual(ids(editorDifferences(src, dst, fields)), ['imagen']);
  });

  test('ajustes del widget distintos, sin contar el help text', () => {
    const src = editor([{ ...builtin('activo', undefined, 'boolean'), settings: { trueLabel: 'Sí' } }]);
    const dst = editor([builtin('activo', undefined, 'boolean')]);
    assert.deepEqual(
      editorDifferences(src, dst, [field('activo', 'Boolean')]).map((d) => d.parts),
      [['settings']],
    );
  });

  describe('campo de referencia (lo que muestra la pantalla de apariencia)', () => {
    const ref = field('ref', 'Array', { items: { type: 'Link', linkType: 'Entry' } });
    const control = (widgetId: string, settings?: EditorControl['settings']): EditorControl => ({
      fieldId: 'ref',
      widgetId,
      widgetNamespace: 'builtin',
      ...(settings && { settings }),
    });
    const defaults = { helpText: '', bulkEditing: false, showCreateEntityAction: true, showLinkEntityAction: true };

    test('los ajustes por defecto guardados al confirmar son iguales a no tenerlos', () => {
      const src = editor([control('entryLinksEditor', defaults)]);
      assert.deepEqual(editorDifferences(src, editor([control('entryLinksEditor')]), [ref]), []);
    });

    test('Entry cards sin "Create new entries" frente a Entry links por defecto: widget y ajuste', () => {
      const src = editor([control('entryCardsEditor', { ...defaults, showCreateEntityAction: false })]);
      const [diff] = editorDifferences(src, editor([control('entryLinksEditor')]), [ref]);
      assert.deepEqual(diff?.parts, ['widget', 'settings']);
      assert.deepEqual(diff?.widget, { src: 'entryCardsEditor', dst: 'entryLinksEditor' });
      assert.deepEqual(diff?.settings, [{ key: 'showCreateEntityAction', src: false, dst: true }]);
    });

    test('solo cambia "Create new entries"', () => {
      const src = editor([control('entryLinksEditor', { showCreateEntityAction: false })]);
      const [diff] = editorDifferences(src, editor([control('entryLinksEditor', defaults)]), [ref]);
      assert.deepEqual(diff?.parts, ['settings']);
    });
  });

  test('de un widget de app en origen solo compara el help text', () => {
    const src = editor([{ fieldId: 'color', widgetId: 'app-1', widgetNamespace: 'app', settings: { paleta: 'x' } }]);
    assert.deepEqual(editorDifferences(src, editor([builtin('color')]), [field('color')]), []);
  });

  test('sin widget por defecto conocido para el tipo, omitir el widget no cuenta como distinto', () => {
    const src = editor([{ fieldId: 'r', widgetId: 'resourceLinkEditor', widgetNamespace: 'builtin' }]);
    const dst = editor([{ fieldId: 'r' }]);
    assert.deepEqual(editorDifferences(src, dst, [field('r', 'ResourceLink')]), []);
  });

  test('solo revisa los campos pedidos', () => {
    const src = editor([builtin('a', 'Ayuda')]);
    assert.deepEqual(editorDifferences(src, editor([]), [field('otro')]), []);
  });
});

describe('mergeControls', () => {
  test('copia la apariencia de los campos pedidos y deja el resto como está en destino', () => {
    const src = [builtin('alt', 'Texto alternativo'), builtin('title', 'Título de origen')];
    const dst = [builtin('alt'), builtin('title', 'Título de destino'), builtin('soloDestino', 'se queda')];
    assert.deepEqual(mergeControls(dst, src, new Set(['alt'])), [
      builtin('alt', 'Texto alternativo'),
      builtin('title', 'Título de destino'),
      builtin('soloDestino', 'se queda'),
    ]);
  });

  test('agrega el control si destino no lo tiene (campo recién agregado)', () => {
    assert.deepEqual(mergeControls([], [builtin('nuevo', 'Ayuda')], new Set(['nuevo'])), [builtin('nuevo', 'Ayuda')]);
  });

  test('de un widget de app en origen copia el help text y conserva el widget de destino', () => {
    const src: EditorControl[] = [
      { fieldId: 'color', widgetId: 'app-1', widgetNamespace: 'app', settings: { helpText: 'Ayuda' } },
    ];
    const dst: EditorControl[] = [
      { fieldId: 'color', widgetId: 'app-9', widgetNamespace: 'app', settings: { paleta: 'x' } },
    ];
    assert.deepEqual(mergeControls(dst, src, new Set(['color'])), [
      { fieldId: 'color', widgetId: 'app-9', widgetNamespace: 'app', settings: { paleta: 'x', helpText: 'Ayuda' } },
    ]);
  });
});

describe('editorDiffsFor', () => {
  test('por content type, solo campos que existen en ambos con el mismo tipo', () => {
    const imagen = diffContentType(
      contentType('imagen', [field('alt'), field('archivo', 'Link', { linkType: 'Asset' }), field('soloOrigen')]),
      contentType('imagen', [field('alt'), field('archivo', 'Link', { linkType: 'Asset' })]),
    );
    const nuevo = diffContentType(contentType('nuevo', [field('title')]), undefined);
    const result = editorDiffsFor(
      [imagen, nuevo],
      new Map([
        [
          'imagen',
          editor([
            builtin('alt', 'Describe la imagen'),
            builtin('archivo', undefined, 'assetLinkEditor'),
            builtin('soloOrigen', 'x'),
          ]),
        ],
        ['nuevo', editor([builtin('title', 'y')])],
      ]),
      new Map([['imagen', editor([builtin('alt'), builtin('archivo', undefined, 'assetLinkEditor')])]]),
    );
    assert.deepEqual(
      [...result].map(([ct, diffs]) => [ct, ids(diffs)]),
      [['imagen', ['alt']]],
    );
  });
});
