import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeAsset } from '../src/core/assets.ts';
import { isFieldChange, migrationChanges, migrationFields, TAGS, VALUE } from '../src/core/entry-compare.ts';
import { assetDetailText, formatBytes } from '../src/text.ts';
import { asset, contentType, entry, field, locales } from './fixtures.ts';

describe('migrationFields: cómo queda cada campo en destino', () => {
  const ct = contentType('banner', [field('title'), field('cta'), field('legal')]);
  const es = locales(['es-CO']);
  const model = (dstCT: ReturnType<typeof contentType> | undefined = ct, srcCT = ct) => ({
    srcCT,
    dstCT,
    locales: { src: es, dst: es },
  });
  const rows = (fields: ReturnType<typeof migrationFields>) =>
    fields.map((f) => [f.id, f.status, f.newField ?? false, f.skipped ?? false]);

  test('también trae los que siguen igual, en el orden del modelo de origen', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, cta: { 'es-CO': 'Comprar' } });
    assert.deepEqual(rows(migrationFields(src, dst, model())), [
      ['title', VALUE.SAME, false, false],
      ['cta', VALUE.DIFFERENT, false, false],
    ]);
  });

  test('sin destino, la entry se crea: cada campo con valor llega nuevo', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, legal: { 'es-CO': 'Términos' } }, ['promo']);
    assert.deepEqual(rows(migrationFields(src, undefined, model())), [
      ['title', VALUE.ONLY_SRC, false, false],
      ['legal', VALUE.ONLY_SRC, false, false],
      [TAGS, VALUE.ONLY_SRC, false, false],
    ]);
  });

  test('un campo con otro tipo en destino sale marcado: no se escribe', () => {
    const src = entry('b', 'banner', { cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', { cta: { 'es-CO': 3 } });
    const dstCT = contentType('banner', [field('title'), field('cta', 'Integer'), field('legal')]);
    const fields = migrationFields(src, dst, model(dstCT));
    assert.deepEqual(rows(fields), [['cta', VALUE.DIFFERENT, false, true]]);
    assert.equal(fields.filter(isFieldChange).length, 0);
  });

  test('un campo que falta en el modelo de destino va como nuevo; con el content type por crear, no', () => {
    const src = entry('b', 'banner', { cta: { 'es-CO': 'Ver' } });
    const withoutCta = contentType('banner', [field('title'), field('legal')]);
    assert.deepEqual(rows(migrationFields(src, entry('b', 'banner'), model(withoutCta))), [
      ['cta', VALUE.ONLY_SRC, true, false],
    ]);
    assert.deepEqual(rows(migrationFields(src, undefined, model(undefined))), [['cta', VALUE.ONLY_SRC, false, false]]);
  });

  test('los tags: iguales si destino ya los tiene; nunca se quita uno', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' } }, ['promo']);
    const same = entry('b', 'banner', { title: { 'es-CO': 'Hola' } }, ['promo', 'otro']);
    assert.deepEqual(
      migrationFields(src, same, model()).map((f) => [f.id, f.status]),
      [
        ['title', VALUE.SAME],
        [TAGS, VALUE.SAME],
      ],
    );
    assert.deepEqual(migrationChanges(src, same, model()), []);
  });

  test('migrationChanges son los campos de migrationFields que cambian', () => {
    const src = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, cta: { 'es-CO': 'Ver' } });
    const dst = entry('b', 'banner', { title: { 'es-CO': 'Hola' }, legal: { 'es-CO': 'x' } });
    assert.deepEqual(migrationChanges(src, dst, model()), migrationFields(src, dst, model()).filter(isFieldChange));
    assert.deepEqual(
      migrationChanges(src, dst, model()).map((f) => [f.id, f.status]),
      [
        ['cta', VALUE.ONLY_SRC],
        ['legal', VALUE.ONLY_DST],
      ],
    );
  });
});

describe('describeAsset', () => {
  const image = asset('img1', { 'es-CO': { url: '//images.ctfassets.net/s1/img1/banner.jpg' } }, { 'es-CO': 'Banner' });
  (image.fields.file['es-CO'] as { details?: unknown }).details = { size: 2048, image: { width: 800, height: 600 } };

  test('nombre, archivo, medidas, peso y URL https', () => {
    assert.deepEqual(describeAsset(image, 'es-CO'), {
      name: 'Banner',
      fileName: 'img1.jpg',
      contentType: 'image/jpeg',
      dimensions: { width: 800, height: 600 },
      bytes: 2048,
      url: 'https://images.ctfassets.net/s1/img1/banner.jpg',
    });
    assert.equal(assetDetailText(describeAsset(image)), 'image/jpeg · 800×600 · 2 KB');
  });

  test('sin título, el nombre del archivo; en otro idioma, el primero que tenga', () => {
    const untitled = asset('doc', { 'en-US': { url: '//assets.ctfassets.net/s1/doc/a.pdf' } });
    const info = describeAsset(untitled, 'es-CO');
    assert.equal(info.name, 'doc.jpg');
    assert.equal(info.dimensions, undefined);
    assert.equal(assetDetailText(info), 'image/jpeg');
  });
});

describe('formatBytes', () => {
  test('B, KB y MB; vacío si no se sabe', () => {
    assert.equal(formatBytes(820), '820 B');
    assert.equal(formatBytes(34 * 1024), '34 KB');
    assert.equal(formatBytes(1.25 * 1024 ** 2), '1.3 MB');
    assert.equal(formatBytes(undefined), '');
  });
});
