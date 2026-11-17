import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { LIMITS } from '../src/config.ts';
import { readEntryTree } from '../src/contentful/read.ts';
import { AbortError } from '../src/errors.ts';
import { entry, fakeCma, link } from './fixtures.ts';

describe('readEntryTree', () => {
  test('lee el árbol completo por niveles y marca los links rotos', async () => {
    const { cma, calls } = fakeCma([
      entry('banner', 'banner', { store: { 'es-CO': link('store') }, roto: { 'es-CO': link('no-existe') } }),
      entry('store', 'store', { municipio: { 'es-CO': link('municipio') } }),
      entry('municipio', 'municipio'),
    ]);

    const tree = await readEntryTree(cma, 'develop', ['banner']);

    assert.deepEqual([...tree.entries.keys()], ['banner', 'store', 'municipio']);
    assert.deepEqual(tree.children.get('banner'), ['store', 'no-existe']);
    assert.deepEqual([...tree.broken], ['no-existe']);
    assert.equal(calls.filter((c) => c.method === 'entry.getMany').length, 3, 'una llamada por nivel');
    assert.ok(calls.every((c) => c.params.environmentId === 'develop'));
  });

  test('si una entry que pegaste no existe, se detiene', async () => {
    const { cma } = fakeCma([]);
    await assert.rejects(readEntryTree(cma, 'develop', ['no-existe']), AbortError);
  });

  test('si faltan varias de las que pegaste, las lista todas', async () => {
    const { cma } = fakeCma([entry('banner', 'banner')]);
    await assert.rejects(readEntryTree(cma, 'develop', ['banner', 'falta1', 'falta2']), (e: Error) => {
      assert.ok(e instanceof AbortError);
      assert.match(e.message, /Estas 2 entries no existen en develop: falta1, falta2/);
      return true;
    });
  });

  test('los ciclos no se quedan en un loop', async () => {
    const { cma } = fakeCma([
      entry('a', 'x', { b: { 'es-CO': link('b') } }),
      entry('b', 'x', { a: { 'es-CO': link('a') } }),
    ]);
    const tree = await readEntryTree(cma, 'develop', ['a']);
    assert.deepEqual([...tree.entries.keys()], ['a', 'b']);
  });
});

describe('readEntryTree: textos enlazados y límite', () => {
  test('un texto enlazado no se recorre como hijo', async () => {
    const body = {
      nodeType: 'document',
      content: [
        { nodeType: 'paragraph', content: [{ nodeType: 'entry-hyperlink', data: { target: link('pagina') } }] },
      ],
    };
    const { cma } = fakeCma([entry('banner', 'banner', { body: { 'es-CO': body } }), entry('pagina', 'page')]);
    const tree = await readEntryTree(cma, 'develop', ['banner']);
    assert.deepEqual([...tree.entries.keys()], ['banner']);
    assert.deepEqual(tree.hyperlinks.get('banner'), ['pagina']);
  });

  test(`si el árbol pasa de ${LIMITS.maxTreeEntries} entries, se detiene`, async () => {
    const kids = Array.from({ length: LIMITS.maxTreeEntries + 1 }, (_, i) => `hijo${i}`);
    const root = entry('banner', 'banner', { items: { 'es-CO': kids.map((id) => link(id)) } });
    const { cma } = fakeCma([root, ...kids.map((id) => entry(id, 'item'))]);
    await assert.rejects(readEntryTree(cma, 'develop', ['banner']), AbortError);
  });
});
