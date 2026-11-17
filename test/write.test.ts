import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createWriter } from '../src/contentful/write.ts';
import { asset, contentType, entry, fakeCma, field, tag } from './fixtures.ts';

describe('createWriter', () => {
  test('no se puede crear apuntando al mismo ambiente de origen ni sin destino', () => {
    const { cma } = fakeCma();
    assert.throws(() => createWriter(cma, { src: 'develop', dst: 'develop' }));
    assert.throws(() => createWriter(cma, { src: 'develop', dst: '' }));
  });

  test('todas sus llamadas van al ambiente destino y ninguna borra, archiva ni despublica', async () => {
    const { cma, calls } = fakeCma([entry('e1', 'banner', { title: { 'es-CO': 'Viejo' } })]);
    const writer = createWriter(cma, { src: 'develop', dst: 'qa' });

    await writer.createTag(tag('navidad'));
    await writer.createContentType(contentType('promo', [field('title')]));
    await writer.addFields(contentType('banner', [field('title')]), [field('subtitle')]);
    await writer.createAsset('img1', asset('img1', { 'es-CO': { url: '//images.ctfassets.net/a.jpg' } }).fields);
    await writer.createEntry('e2', 'banner', { title: { 'es-CO': 'Nuevo' } }, []);
    await writer.updateEntry('e1', (current) => ({
      fields: { ...current.fields, title: { 'es-CO': 'Nuevo' } },
      tags: [],
    }));
    await writer.updateEditorInterface('banner', (current) => current);
    await writer.updateFieldRules(contentType('banner', [field('title')]), (f) => ({ ...f, required: true }));

    assert.ok(calls.length > 0);
    assert.ok(calls.some((c) => c.method === 'editorInterface.update'));
    for (const call of calls) {
      assert.equal(call.params.environmentId, 'qa', `${call.method} no fue a qa`);
      assert.doesNotMatch(call.method, /delete|archive|unpublish/i);
    }
  });

  test('cambiar reglas de campos no agrega, quita ni cambia el tipo de ninguno, y publica', async () => {
    const { cma, calls } = fakeCma();
    const writer = createWriter(cma, { src: 'develop', dst: 'qa' });
    const banner = contentType('banner', [field('title'), field('cta')]);

    await writer.updateFieldRules(banner, (f) => (f.id === 'title' ? { ...f, name: 'Título', required: true } : f));
    const update = calls.find((c) => c.method === 'contentType.update');
    assert.ok(update);
    assert.deepEqual((update.data as { fields: unknown }).fields, [
      { ...field('title'), name: 'Título', required: true },
      field('cta'),
    ]);
    assert.ok(calls.some((c) => c.method === 'contentType.publish'));

    await assert.rejects(
      writer.updateFieldRules(banner, (f) => ({ ...f, type: 'Text' })),
      /tipo/,
    );
  });

  test('al actualizar parte de la versión actual en destino y aplica los campos nuevos', async () => {
    const { cma, calls } = fakeCma([entry('e1', 'banner', { title: { 'es-CO': 'Viejo' } })]);
    const writer = createWriter(cma, { src: 'develop', dst: 'qa' });

    await writer.updateEntry('e1', (current) => ({
      fields: { ...current.fields, title: { 'es-CO': 'Nuevo' } },
      tags: [],
    }));

    const update = calls.find((c) => c.method === 'entry.update');
    assert.ok(update);
    assert.deepEqual((update.data as { fields: unknown }).fields, { title: { 'es-CO': 'Nuevo' } });
    assert.ok(calls.findIndex((c) => c.method === 'entry.get') < calls.indexOf(update));
  });

  test('respalda la versión actual antes de actualizar; si el respaldo falla, no actualiza', async () => {
    const { cma, calls } = fakeCma([entry('e1', 'banner', { title: { 'es-CO': 'Viejo' } })]);
    const writer = createWriter(cma, { src: 'develop', dst: 'qa' });

    const seen: unknown[] = [];
    await writer.updateEntry(
      'e1',
      (current) => ({ fields: current.fields, tags: [] }),
      (current) => {
        seen.push(current.fields);
        assert.equal(calls.filter((c) => c.method === 'entry.update').length, 0, 'todavía no actualizó');
      },
    );
    assert.deepEqual(seen, [{ title: { 'es-CO': 'Viejo' } }]);

    const before = calls.length;
    await assert.rejects(
      writer.updateEntry(
        'e1',
        (current) => ({ fields: current.fields, tags: [] }),
        () => {
          throw new Error('disco lleno');
        },
      ),
    );
    assert.equal(
      calls.slice(before).some((c) => c.method === 'entry.update'),
      false,
    );
  });

  test('solo publica content types', async () => {
    const { cma, calls } = fakeCma([entry('e1', 'banner')]);
    const writer = createWriter(cma, { src: 'develop', dst: 'qa' });
    await writer.createAsset('img1', asset('img1', { 'es-CO': { url: '//images.ctfassets.net/a.jpg' } }).fields);
    await writer.createEntry('e2', 'banner', {}, []);
    await writer.updateEntry('e1', (current) => ({ fields: current.fields, tags: [] }));
    await writer.createContentType(contentType('promo', [field('title')]));

    const published = calls.filter((c) => c.method.endsWith('.publish')).map((c) => c.method);
    assert.deepEqual(published, ['contentType.publish']);
  });
});
