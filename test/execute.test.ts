/**
 * Escritura de punta a punta con un CMA falso (sin red): el orden de las fases, lo que
 * llega a Contentful y lo que queda en el respaldo.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import type { ContentType, EditorControl, EditorInterface, Entry } from '../src/contentful/types.ts';
import { createWriter } from '../src/contentful/write.ts';
import { editorDifferences } from '../src/core/editor.ts';
import { CHANGE, modelChangesFrom } from '../src/core/model-changes.ts';
import { buildPlan } from '../src/core/plan.ts';
import { applyModelChanges, executePlan, type WriteContext } from '../src/execute.ts';
import { readBackup, startBackup } from '../src/node/backups.ts';
import { createRecordingRunner } from '../src/runner.ts';
import { analysisOf, contentType, entry, fakeCma, field, locales } from './fixtures.ts';

const editor = (controls: EditorControl[]) => ({ sys: { version: 1 }, controls }) as unknown as EditorInterface;
const control = (fieldId: string, helpText?: string): EditorControl => ({
  fieldId,
  widgetId: 'singleLine',
  widgetNamespace: 'builtin',
  ...(helpText && { settings: { helpText } }),
});
const tagIds = (e: { metadata?: { tags: { sys: { id: string } }[] } }) => e.metadata?.tags.map((t) => t.sys.id);

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfm-execute-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeContext(
  cma: ReturnType<typeof fakeCma>['cma'],
  kind: 'migrate' | 'model' = 'migrate',
): WriteContext & { backup: ReturnType<typeof startBackup> } {
  return {
    writer: createWriter(cma, { src: 'develop', dst: 'master' }),
    backup: startBackup(
      {
        kind,
        spaceId: 's1',
        src: 'develop',
        dst: 'master',
        rootIds: ['b'],
        account: { userId: 'u1', email: undefined, host: 'api.contentful.com' },
      },
      dir,
    ),
    runner: createRecordingRunner(),
  };
}

describe('executePlan: actualizar una entry con cambios de modelo', () => {
  const both = locales(['es-CO', 'en-US']);
  const srcCT = contentType('banner', [field('title'), field('subtitle')]);
  const dstCT = contentType('banner', [field('title', 'Symbol', { localized: true })]);
  const dstEntry = entry('b', 'banner', { title: { 'es-CO': 'Viejo', 'en-US': 'Old' } }, ['solo-master']);

  test('agrega el campo, copia el help text y actualiza la entry sin perder lo que solo tiene destino', async () => {
    const base = analysisOf({
      rootIds: ['b'],
      entries: [entry('b', 'banner', { title: { 'es-CO': 'Nuevo' }, subtitle: { 'es-CO': 'Sub' } }, ['navidad'])],
      dstEntries: [dstEntry],
      srcCTs: [srcCT],
      dstCTs: [dstCT],
    });
    const analysis = {
      ...base,
      locales: { src: both, dst: both, missing: [] },
      tags: { dstIds: new Set(['navidad', 'solo-master']), missing: [] },
    };
    const subtitle = srcCT.fields[1];
    assert.ok(subtitle);
    const editorDiff = {
      fieldId: 'title',
      parts: ['helpText' as const],
      helpText: { src: 'Ayuda' },
      widget: {},
      settings: [],
    };
    const plan = buildPlan(analysis, {
      withAssets: false,
      picked: [
        { kind: CHANGE.ADD, ctId: 'banner', field: subtitle },
        { kind: CHANGE.EDITOR, ctId: 'banner', editor: editorDiff },
      ],
    });

    const { cma, calls } = fakeCma([dstEntry], new Map([['banner', editor([control('title')])]]));
    const ctx = writeContext(cma);
    const srcEditors = new Map([['banner', editor([control('title', 'Ayuda'), control('subtitle', 'Subtítulo')])]]);
    const failures = await executePlan(plan, analysis, async () => srcEditors, ctx);

    assert.deepEqual(failures, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      [
        'contentType.update',
        'contentType.publish',
        'editorInterface.get',
        'editorInterface.update',
        'entry.get',
        'entry.update',
      ],
      'primero el modelo y la apariencia, después la entry',
    );

    const dataOf = <T>(i: number) => calls[i]?.data as T;
    const added = dataOf<ContentType>(0);
    assert.deepEqual(
      added.fields.map((f) => f.id),
      ['title', 'subtitle'],
    );

    const controls = dataOf<EditorInterface>(3).controls;
    assert.deepEqual(controls, [control('title', 'Ayuda'), control('subtitle', 'Subtítulo')]);

    const updated = dataOf<Entry>(5);
    assert.deepEqual(updated.fields, {
      title: { 'es-CO': 'Nuevo', 'en-US': 'Old' },
      subtitle: { 'es-CO': 'Sub' },
    });
    assert.deepEqual(tagIds(updated), ['solo-master', 'navidad'], 'nunca quita un tag de destino');

    const saved = readBackup(ctx.backup.file);
    assert.deepEqual(saved.fieldsAdded, { banner: ['subtitle'] });
    assert.deepEqual(saved.editorUpdated, { banner: ['subtitle', 'title'] });
    assert.deepEqual(
      saved.updated.map((u) => [u.id, u.applied, u.fields]),
      [['b', true, dstEntry.fields]],
    );
  });
});

describe('applyModelChanges: campo de referencia nuevo con su apariencia (caso real)', () => {
  test('agrega el campo y lleva Entry cards sin "Create new entries", en el mismo orden que las herramientas oficiales', async () => {
    const reference = field('referenciaPantalla', 'Array', { items: { type: 'Link', linkType: 'Entry' } });
    const dstCT = contentType('banner', [field('title')]);
    const fromDevelop: EditorControl = {
      fieldId: 'referenciaPantalla',
      widgetId: 'entryCardsEditor',
      widgetNamespace: 'builtin',
      settings: { helpText: '', bulkEditing: false, showCreateEntityAction: false, showLinkEntityAction: true },
    };
    // Así queda la apariencia en master al publicar: Contentful agrega el control por defecto del campo nuevo.
    const afterPublish = editor([
      control('title'),
      { fieldId: 'referenciaPantalla', widgetId: 'entryLinksEditor', widgetNamespace: 'builtin' },
    ]);
    const { cma, calls } = fakeCma([], new Map([['banner', afterPublish]]));
    const ctx = writeContext(cma, 'model');
    const changes = modelChangesFrom([{ kind: CHANGE.ADD, ctId: 'banner', field: reference }], new Map());
    const srcEditors = new Map([['banner', editor([control('title'), fromDevelop])]]);
    await applyModelChanges(changes, new Map([['banner', dstCT]]), async () => srcEditors, ctx);

    assert.deepEqual(ctx.runner.failures, []);
    assert.deepEqual(
      calls.map((c) => c.method),
      ['contentType.update', 'contentType.publish', 'editorInterface.get', 'editorInterface.update'],
    );
    const saved = calls[3]?.data as EditorInterface;
    assert.deepEqual(saved.controls, [control('title'), fromDevelop], 'título intacto; la referencia, como en develop');
    assert.equal(editorDifferences(srcEditors.get('banner'), saved, [reference]).length, 0, 'ya no hay diferencias');
    assert.deepEqual(readBackup(ctx.backup.file).editorUpdated, { banner: ['referenciaPantalla'] });
  });
});

describe('applyModelChanges: datos del content type y reglas', () => {
  const srcCT = {
    ...contentType('banner', [field('title', 'Symbol', { name: 'Título', required: true }), field('slug')], 'slug'),
    name: 'Banner principal',
  } as ContentType;
  const dstCT = contentType('banner', [field('title')]);
  const info = [{ part: 'displayField' as const, src: 'slug', dst: 'title' }];
  const slug = srcCT.fields[1];
  const title = srcCT.fields[0];
  assert.ok(slug && title);

  test('un campo de título que no existe en destino no se aplica (y no se escribe nada)', async () => {
    const { cma, calls } = fakeCma();
    const ctx = writeContext(cma, 'model');
    const changes = modelChangesFrom([{ kind: CHANGE.INFO, ctId: 'banner', info }], new Map([['banner', srcCT]]));
    await applyModelChanges(changes, new Map([['banner', dstCT]]), async () => new Map(), ctx);

    assert.equal(ctx.runner.failures.length, 1);
    assert.deepEqual(calls, []);
  });

  test('con el campo agregado en la misma ejecución, cambia el campo de título después de agregarlo', async () => {
    const { cma, calls } = fakeCma();
    const ctx = writeContext(cma, 'model');
    const changes = modelChangesFrom(
      [
        { kind: CHANGE.INFO, ctId: 'banner', info },
        { kind: CHANGE.ADD, ctId: 'banner', field: slug },
        { kind: CHANGE.RULES, ctId: 'banner', field: title },
      ],
      new Map([['banner', srcCT]]),
    );
    const editors = new Map([['banner', editor([control('slug')])]]);
    await applyModelChanges(changes, new Map([['banner', dstCT]]), async () => editors, ctx);

    assert.deepEqual(ctx.runner.failures, []);
    const updates = calls.filter((c) => c.method === 'contentType.update').map((c) => c.data as ContentType);
    assert.equal(updates.length, 3, 'agregar campo, reglas, datos');
    assert.deepEqual(
      updates[1]?.fields.map((f) => [f.id, f.name, f.required]),
      [
        ['title', 'Título', true],
        ['slug', 'slug', false],
      ],
    );
    assert.deepEqual(
      [updates[2]?.name, updates[2]?.displayField, updates[2]?.fields.length],
      ['Banner principal', 'slug', 2],
    );
    assert.deepEqual(
      calls.filter((c) => c.method === 'contentType.update').map((c) => (c.data as ContentType).sys.version),
      [undefined, 2, 4],
      'cada escritura parte de la versión que devolvió la anterior',
    );

    const saved = readBackup(ctx.backup.file);
    assert.deepEqual(saved.rulesUpdated, { banner: [field('title')] });
    assert.deepEqual(saved.infoUpdated, { banner: { name: 'banner', description: '', displayField: 'title' } });
  });
});
