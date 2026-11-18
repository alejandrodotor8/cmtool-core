/**
 * Las migraciones por etapas, de punta a punta con un Contentful falso de dos ambientes (sin
 * red): cada etapa sale de la anterior, volver atrás no repite lecturas y solo `execute`
 * escribe, siempre en destino.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { type BackupData, createBackup } from '../src/backup.ts';
import { openSpace } from '../src/connection.ts';
import type { Entry } from '../src/contentful/types.ts';
import { CHANGE } from '../src/core/model-changes.ts';
import { RESTORE } from '../src/core/restore.ts';
import { AbortError } from '../src/errors.ts';
import { assetMigration } from '../src/migrations/assets.ts';
import { entryMigration } from '../src/migrations/entries.ts';
import { modelMigration } from '../src/migrations/model.ts';
import { backupRestore } from '../src/migrations/restore.ts';
import { createRecordingRunner } from '../src/runner.ts';
import { asset, contentType, editorOf, entry, type FakeEnvironment, fakeContentful, field, link } from './fixtures.ts';

const envs = { src: 'develop', dst: 'qa' };
const account = { userId: 'u1', email: undefined, host: 'api.contentful.com' };

/** Respaldo en memoria y runner sin pantalla. */
function writeTools(kind: BackupData['kind'] = 'migrate') {
  const backup = createBackup({ kind, spaceId: 's1', ...envs, rootIds: [], account }, () => {});
  return { backup, runner: createRecordingRunner() };
}

const withVersion = (e: Entry, version: number): Entry => ({ ...e, sys: { ...e.sys, version } }) as Entry;

const pageCT = contentType('page', [field('title'), field('banner', 'Link', { linkType: 'Entry' })]);
const bannerCT = contentType('banner', [field('title')]);
const page = (title: string) =>
  entry('page', 'page', { title: { 'es-CO': title }, banner: { 'es-CO': link('banner') } });
const banner = entry('banner', 'banner', { title: { 'es-CO': 'Promo' } });

/** develop tiene una página con su banner; qa, el mismo modelo y lo que se pase. */
function twoEnvironments(qa: FakeEnvironment = {}) {
  const model = { contentTypes: [pageCT, bannerCT] };
  const environments = {
    develop: { ...model, entries: [page('Inicio'), banner] },
    qa: { ...model, entries: [] as Entry[], ...qa },
  };
  const fake = fakeContentful(environments);
  return { ...fake, environments, space: openSpace(fake.cma) };
}

describe('entryMigration: de punta a punta', () => {
  test('analizar → revisar → plan → escribir: crea la página y su banner, solo en destino', async () => {
    const { space, writes } = twoEnvironments();
    const tree = await entryMigration(space, envs).analyze(['page']);
    assert.equal(tree.analysis.tree.entries.size, 2);
    assert.deepEqual(tree.candidates, [], 'nada existe en destino: no hay qué actualizar');
    assert.deepEqual(
      tree.analysis.fields.get('page')?.map((f) => [f.id, f.status]),
      [
        ['title', 'only-src'],
        ['banner', 'only-src'],
      ],
      'de lo que se crea, cada campo con su valor',
    );

    const review = await tree.review(tree.defaultUpdates());
    const choices = await review.modelChoices();
    assert.equal(choices.all.length, 0, 'mismo modelo en los dos ambientes');

    const plan = review.plan({ withAssets: false, picked: [] });
    assert.equal(plan.isEmpty, false);
    assert.deepEqual(
      plan.plan.entries.map((e) => `${e.action} ${e.id}`),
      ['create page', 'create banner'],
    );
    assert.deepEqual(writes(), [], 'analizar y planear no escriben');

    const tools = writeTools();
    assert.deepEqual(await plan.execute(tools), []);
    assert.deepEqual(
      writes().map((c) => `${c.method} ${c.params.environmentId} ${c.params.entryId}`),
      ['entry.createWithId qa page', 'entry.createWithId qa banner'],
    );
    assert.deepEqual(tools.backup.data.created.entries, ['page', 'banner']);
  });

  test('volver a una etapa no repite lecturas', async () => {
    const { space, count } = twoEnvironments();
    const migration = entryMigration(space, envs);
    const tree = await migration.analyze(['page']);
    const reads = count('entry.getMany');
    assert.equal(await migration.analyze(['page']), tree);
    assert.equal(count('entry.getMany'), reads);

    const review = await tree.review(new Set());
    assert.equal(await tree.review(new Set()), review);
  });

  test('es la misma migración para el mismo space, origen y destino', () => {
    const { space } = twoEnvironments();
    assert.equal(entryMigration(space, envs), entryMigration(space, { ...envs }));
    assert.notEqual(entryMigration(space, envs), entryMigration(space, { src: 'qa', dst: 'develop' }));
    assert.throws(() => entryMigration(space, { src: 'qa', dst: 'qa' }), AbortError);
  });

  test('lo que ya existe y cambió se puede actualizar: por defecto la entry elegida, no sus hijos', async () => {
    const { space } = twoEnvironments({
      entries: [page('Viejo'), entry('banner', 'banner', { title: { 'es-CO': 'Otra' } })],
    });
    const tree = await entryMigration(space, envs).analyze(['page']);
    assert.deepEqual(
      tree.candidates.map((c) => c.id),
      ['page', 'banner'],
    );
    assert.deepEqual([...tree.defaultUpdates()], ['page']);
    assert.equal(tree.writes(new Set(['page'])), 1);
    assert.equal(tree.writes(new Set()), 0);

    assert.equal(tree.updateDecision(new Set(['page', 'banner'])), 'all');
    assert.equal(tree.updateDecision(new Set()), 'none');
    const { chosen, unknown } = tree.applyUpdateDecision(['page', 'otra']);
    assert.deepEqual([...chosen], ['page']);
    assert.deepEqual(unknown, ['otra']);
  });

  test('changesInDestination avisa si destino cambió después del análisis', async () => {
    const { space, environments } = twoEnvironments();
    const tree = await entryMigration(space, envs).analyze(['page']);
    const plan = (await tree.review(new Set())).plan({ withAssets: false, picked: [] });
    assert.deepEqual(await plan.changesInDestination(), []);

    // Alguien crea la página en qa mientras se revisa el plan.
    environments.qa.entries.push(page('Nueva'));
    assert.deepEqual(await plan.changesInDestination(), ['page']);
  });
});

describe('modelMigration', () => {
  const setup = (qaFields: string[]) =>
    openSpace(
      fakeContentful({
        develop: {
          contentTypes: [contentType('banner', [field('title'), field('subtitle')])],
          editors: [editorOf('banner', ['title', 'subtitle'])],
        },
        qa: {
          contentTypes: [
            contentType(
              'banner',
              qaFields.map((id) => field(id)),
            ),
          ],
          editors: [editorOf('banner', qaFields)],
        },
      }).cma,
    );

  test('ofrece el campo que falta y lo agrega en destino', async () => {
    const fake = fakeContentful({
      develop: {
        contentTypes: [contentType('banner', [field('title'), field('subtitle')])],
        editors: [editorOf('banner', ['title', 'subtitle'])],
      },
      qa: { contentTypes: [contentType('banner', [field('title')])], editors: [editorOf('banner', ['title'])] },
    });
    const review = await modelMigration(openSpace(fake.cma), envs).analyze();
    assert.equal(review.isUpToDate, false);
    assert.deepEqual(
      review.choices.all.map((pick) => pick.kind),
      [CHANGE.ADD],
    );

    const none = review.plan([]);
    assert.equal(none.isEmpty, true);
    assert.deepEqual(none.notAdded, ['banner.subtitle']);

    const plan = review.plan(review.choices.all);
    assert.equal(plan.changesStructure, true);
    assert.deepEqual(await plan.execute(writeTools('model')), []);
    const written = fake.writes();
    assert.ok(written.length);
    assert.ok(written.every((c) => (c.params as { environmentId?: string }).environmentId === 'qa'));
    assert.ok(written.some((c) => c.method === 'contentType.publish'));
  });

  test('con el mismo modelo y la misma apariencia, no hay nada que elegir', async () => {
    assert.equal((await modelMigration(setup(['title', 'subtitle']), envs).analyze()).isUpToDate, true);
  });

  test('un content type pedido que no existe se detiene con un mensaje claro', async () => {
    await assert.rejects(
      modelMigration(setup(['title']), envs).analyze({ contentTypes: ['nope'] }),
      (e: unknown) => e instanceof AbortError && /no existen: nope/.test(e.message),
    );
  });
});

describe('assetMigration', () => {
  test('reutiliza lo que existe y crea en destino lo que falta', async () => {
    const file = (id: string) => asset(id, { 'es-CO': { url: `//images.ctfassets.net/s1/${id}/abc/${id}.jpg` } });
    const fake = fakeContentful({ develop: { assets: [file('a1'), file('a2')] }, qa: { assets: [file('a1')] } });
    const review = await assetMigration(openSpace(fake.cma), envs).analyze(['a1', 'a2', 'a3']);
    assert.deepEqual([...review.assets.existing], ['a1']);
    assert.deepEqual(review.assets.missing, ['a2']);
    assert.equal(review.isEmpty, false);

    const tools = writeTools('assets');
    assert.deepEqual(await review.execute(tools), []);
    assert.deepEqual(
      fake.writes().map((c) => `${c.method} ${(c.params as { environmentId?: string }).environmentId}`),
      ['asset.createWithId qa', 'asset.processForAllLocales qa'],
    );
    assert.deepEqual(tools.backup.data.created.assets, ['a2']);
  });
});

describe('backupRestore', () => {
  const saved = (id: string, applied = true) => ({
    id,
    contentType: 'page',
    title: id,
    version: 3,
    fields: { title: { 'es-CO': 'Como estaba' } },
    tags: [],
    applied,
  });
  const data: BackupData = {
    version: 1,
    kind: 'migrate',
    createdAt: '2026-11-18T00:00:00.000Z',
    account,
    spaceId: 's1',
    ...envs,
    rootIds: ['page'],
    updated: [saved('page'), saved('gone'), saved('failed', false)],
    created: { entries: [], assets: [], contentTypes: [], tags: [] },
    fieldsAdded: {},
  };

  test('devuelve a como estaba lo que nadie tocó después, y omite lo demás', async () => {
    const current = withVersion(entry('page', 'page', { title: { 'es-CO': 'Migrada' } }), 4);
    const fake = fakeContentful({ develop: {}, qa: { entries: [current] } });
    const review = await backupRestore(openSpace(fake.cma), data).analyze();
    assert.deepEqual(
      review.items.map((i) => `${i.saved.id} ${i.status}`),
      [`page ${RESTORE.RESTORE}`, `gone ${RESTORE.MISSING}`, `failed ${RESTORE.NOT_APPLIED}`],
    );
    assert.deepEqual(
      review.toRestore.map((s) => s.id),
      ['page'],
    );

    const tools = writeTools('restore');
    assert.deepEqual(await review.execute(tools), []);
    const updates = fake.writes();
    assert.deepEqual(
      updates.map((c) => `${c.method} ${(c.params as { environmentId?: string }).environmentId}`),
      ['entry.update qa'],
    );
    assert.deepEqual((updates[0]?.data as Entry | undefined)?.fields, { title: { 'es-CO': 'Como estaba' } });
    assert.deepEqual(
      tools.backup.data.updated.map((s) => `${s.id} ${s.applied}`),
      ['page true'],
      'el restore también se respalda',
    );
  });
});
