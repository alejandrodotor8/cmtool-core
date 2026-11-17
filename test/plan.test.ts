import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Entry, Field } from '../src/contentful/types.ts';
import { modelOptions as modelOptionsFor } from '../src/core/model-changes.ts';
import {
  ACTION,
  brokenHyperlinks,
  buildPlan,
  changedInDst,
  classifyTree,
  defaultUpdates,
  updateCandidates,
  writtenContentTypes,
} from '../src/core/plan.ts';
import { analysisOf, asset, contentType, entry, field, link, tag, treeOf, writtenIds } from './fixtures.ts';

describe('classifyTree', () => {
  // banner (pegado, no existe en qa)
  // ├─ store (existe en qa)
  // │  └─ municipio (existe en qa)
  // │     └─ departamento (no existe en qa, cuelga de una reutilizada)
  // └─ slide (no existe en qa)
  //    └─ item (no existe en qa)
  const entries = [
    entry('banner', 'banner', { store: { 'es-CO': link('store') }, slide: { 'es-CO': link('slide') } }),
    entry('store', 'store', { municipio: { 'es-CO': link('municipio') } }),
    entry('municipio', 'municipio', { departamento: { 'es-CO': link('departamento') } }),
    entry('departamento', 'departamento'),
    entry('slide', 'slide', { item: { 'es-CO': link('item') } }),
    entry('item', 'item'),
  ];
  const actions = classifyTree(['banner'], treeOf(entries), new Set(['store', 'municipio']));

  test('lo que pegas y no existe en destino se crea', () => {
    assert.equal(actions.get('banner'), ACTION.CREATE);
  });

  test('los hijos que no existen en destino se crean, en cadena', () => {
    assert.equal(actions.get('slide'), ACTION.CREATE);
    assert.equal(actions.get('item'), ACTION.CREATE);
  });

  test('un hijo que ya existe en destino se reutiliza, igual que lo que tiene debajo', () => {
    assert.equal(actions.get('store'), ACTION.REUSE);
    assert.equal(actions.get('municipio'), ACTION.REUSE);
  });

  test('lo que no existe pero cuelga de un hijo reutilizado no se crea', () => {
    assert.equal(actions.get('departamento'), ACTION.ORPHAN);
  });

  test('lo que pegas y ya existe en destino se actualiza', () => {
    const tree = treeOf([entry('banner', 'banner')]);
    assert.equal(classifyTree(['banner'], tree, new Set(['banner'])).get('banner'), ACTION.UPDATE);
  });

  test('un hijo que también pegaste se actualiza aunque ya exista', () => {
    const tree = treeOf([entry('banner', 'banner', { store: { 'es-CO': link('store') } }), entry('store', 'store')]);
    const result = classifyTree(['banner', 'store'], tree, new Set(['store']));
    assert.equal(result.get('store'), ACTION.UPDATE);
  });

  test('los ciclos no se quedan en un loop', () => {
    const tree = treeOf([
      entry('a', 'x', { b: { 'es-CO': link('b') } }),
      entry('b', 'x', { a: { 'es-CO': link('a') } }),
    ]);
    const result = classifyTree(['a'], tree, new Set());
    assert.equal(result.get('a'), ACTION.CREATE);
    assert.equal(result.get('b'), ACTION.CREATE);
  });
});

describe('modelOptions', () => {
  const modelOptions = (a: ReturnType<typeof analysisOf>) => modelOptionsFor(a.diffs.values(), writtenContentTypes(a));

  const banner = contentType('banner', [field('title')]);
  const storeSrc = contentType('store', [field('title'), field('codigo')]);
  const storeDst = contentType('store', [field('title')]);
  const dep = contentType('departamento', [field('title')]);

  const analysis = analysisOf({
    rootIds: ['banner'],
    entries: [
      entry('banner', 'banner', { store: { 'es-CO': link('store') } }),
      entry('store', 'store', { departamento: { 'es-CO': link('dep') } }),
      entry('dep', 'departamento'),
    ],
    existsInDst: ['store'],
    srcCTs: [banner, storeSrc, dep],
    dstCTs: [banner, storeDst],
  });

  test('ofrece campos que faltan aunque solo los usen entries reutilizadas, marcándolo', () => {
    const store = modelOptions(analysis).find((o) => o.diff.id === 'store');
    assert.ok(store);
    assert.equal(store.onlyReused, true);
    assert.deepEqual(
      store.diff.missing.map((f) => f.id),
      ['codigo'],
    );
  });

  test('no ofrece crear un content type que solo usan entries que no se escriben', () => {
    assert.equal(
      modelOptions(analysis).some((o) => o.diff.id === 'departamento'),
      false,
    );
  });

  test('no ofrece content types al día', () => {
    assert.equal(
      modelOptions(analysis).some((o) => o.diff.id === 'banner'),
      false,
    );
  });
});

describe('buildPlan', () => {
  const bannerSrc = contentType('banner', [field('title'), field('subtitle'), field('cta')]);
  const bannerDst = contentType('banner', [field('title')]);
  const promo = contentType('promo', [field('title')]);

  const analysis = analysisOf({
    rootIds: ['banner', 'promo1'],
    entries: [entry('banner', 'banner', { image: { 'es-CO': link('img1', 'Asset') } }), entry('promo1', 'promo')],
    srcCTs: [bannerSrc, promo],
    dstCTs: [bannerDst],
    srcAssets: [asset('img1', { 'es-CO': { url: '//images.ctfassets.net/img1.jpg' } })],
    missingTags: [tag('navidad')],
  });

  test('sin crear su content type, la entry se omite', () => {
    const plan = buildPlan(analysis, { withAssets: false, picked: [] });
    assert.deepEqual(plan.skipped, ['promo1']);
    assert.deepEqual(
      plan.entries.map((e) => e.id),
      ['banner'],
    );
  });

  test('si marcas crear el content type, la entry se migra', () => {
    const plan = buildPlan(analysis, { withAssets: false, picked: [{ kind: 'create', ctId: 'promo' }] });
    assert.deepEqual(
      plan.contentTypesToCreate.map((ct) => ct.sys.id),
      ['promo'],
    );
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.entries.map((e) => e.id).sort(), ['banner', 'promo1']);
  });

  test('agrupa los campos marcados por content type y reporta los que no se marcaron', () => {
    const subtitle = bannerSrc.fields[1];
    assert.ok(subtitle);
    const plan = buildPlan(analysis, { withAssets: false, picked: [{ kind: 'add', ctId: 'banner', field: subtitle }] });
    assert.deepEqual(
      plan.fieldsToAdd.get('banner')?.map((f) => f.id),
      ['subtitle'],
    );
    assert.deepEqual(plan.notAdded, ['banner.cta']);
  });

  test('sin imágenes no crea assets; con imágenes crea los que faltan', () => {
    assert.deepEqual(buildPlan(analysis, { withAssets: false, picked: [] }).assetsToCreate, []);
    const plan = buildPlan(analysis, { withAssets: true, picked: [] });
    assert.deepEqual(
      plan.assetsToCreate.map((a) => a.sys.id),
      ['img1'],
    );
  });

  test('crea los tags que faltan', () => {
    const plan = buildPlan(analysis, { withAssets: false, picked: [] });
    assert.deepEqual(
      plan.tagsToCreate.map((t) => t.sys.id),
      ['navidad'],
    );
  });

  test('solo escribe entries del árbol que se crean o actualizan', () => {
    assert.deepEqual(writtenIds(analysis).sort(), ['banner', 'promo1']);
  });
});

const archivedEntry = (id: string, ct: string): Entry => {
  const e = entry(id, ct);
  (e.sys as Entry['sys']).archivedVersion = 2;
  return e;
};

describe('entries archivadas en destino', () => {
  test('una entry que pegaste y está archivada en destino no se actualiza', () => {
    const ct = contentType('banner', [field('title')]);
    const analysis = analysisOf({
      rootIds: ['banner'],
      entries: [entry('banner', 'banner')],
      dstEntries: [archivedEntry('banner', 'banner')],
      srcCTs: [ct],
      dstCTs: [ct],
    });
    const plan = buildPlan(analysis, { withAssets: false, picked: [] });
    assert.deepEqual(plan.archived, ['banner']);
    assert.deepEqual(plan.entries, []);
  });
});

describe('brokenHyperlinks', () => {
  const hyperlinkTo = (id: string) => ({
    'es-CO': { nodeType: 'document', content: [{ nodeType: 'entry-hyperlink', data: { target: link(id) } }] },
  });
  const ct = contentType('banner', [field('title'), field('body', 'RichText')]);

  test('avisa si un texto enlazado apunta a una entry que no existirá en destino', () => {
    const analysis = analysisOf({
      rootIds: ['banner'],
      entries: [entry('banner', 'banner', { body: hyperlinkTo('pagina') })],
      srcCTs: [ct],
      dstCTs: [ct],
    });
    assert.deepEqual(Object.fromEntries(brokenHyperlinks(analysis)), { banner: ['pagina'] });
  });

  test('si la entry enlazada ya existe en destino, no hay aviso', () => {
    const analysis = analysisOf({
      rootIds: ['banner'],
      entries: [entry('banner', 'banner', { body: hyperlinkTo('pagina') })],
      existsInDst: ['pagina'],
      srcCTs: [ct],
      dstCTs: [ct],
    });
    assert.equal(brokenHyperlinks(analysis).size, 0);
  });
});

describe('changedInDst', () => {
  test('detecta entries que aparecieron, desaparecieron o se archivaron', () => {
    const before = new Map([
      ['a', entry('a', 'x')],
      ['b', entry('b', 'x')],
      ['c', entry('c', 'x')],
    ]);
    const after = new Map([
      ['b', entry('b', 'x')],
      ['c', archivedEntry('c', 'x')],
      ['d', entry('d', 'x')],
    ]);
    assert.deepEqual(changedInDst(['a', 'b', 'c', 'd'], before, after), ['a', 'c', 'd']);
  });

  test('si nada cambió, no hay diferencias', () => {
    const state = new Map([['a', entry('a', 'x')]]);
    assert.deepEqual(changedInDst(['a', 'b'], state, new Map(state)), []);
  });

  test('una entry que se va a actualizar y alguien editó en destino cuenta como cambio', () => {
    const withVersion = (version: number) => {
      const e = entry('a', 'x');
      (e.sys as { version: number }).version = version;
      return e;
    };
    const before = new Map([['a', withVersion(3)]]);
    const after = new Map([['a', withVersion(4)]]);
    assert.deepEqual(changedInDst(['a'], before, after, new Set(['a'])), ['a']);
    assert.deepEqual(changedInDst(['a'], before, after), [], 'si no se actualiza, editarla no importa');
  });
});

describe('buildPlan: actualizaciones que no escribirían nada', () => {
  const srcCT = contentType('banner', [field('title'), field('subtitle')]);
  const dstCT = contentType('banner', [field('title')]);
  const analysis = analysisOf({
    rootIds: ['b'],
    entries: [entry('b', 'banner', { title: { 'es-CO': 'Hola' }, subtitle: { 'es-CO': 'Nuevo' } })],
    dstEntries: [entry('b', 'banner', { title: { 'es-CO': 'Hola' } })],
    srcCTs: [srcCT],
    dstCTs: [dstCT],
  });
  const subtitle = srcCT.fields[1] as Field;

  test('si solo cambia un campo nuevo y no se agrega al modelo, la entry no se actualiza', () => {
    const plan = buildPlan(analysis, { withAssets: false, picked: [] });
    assert.deepEqual(plan.entries, []);
    assert.deepEqual(plan.unchanged, ['b']);
  });

  test('si se agrega el campo, la entry se actualiza', () => {
    const plan = buildPlan(analysis, { withAssets: false, picked: [{ kind: 'add', ctId: 'banner', field: subtitle }] });
    assert.deepEqual(
      plan.entries.map((e) => [e.id, e.action]),
      [['b', 'update']],
    );
    assert.deepEqual(plan.unchanged, []);
  });
});

describe('classifyTree con lo que se decide actualizar', () => {
  // banner (pegado, existe) → slide (existe) → item (no existe)
  const tree = treeOf([
    entry('banner', 'banner', { slide: { 'es-CO': link('slide') } }),
    entry('slide', 'slide', { item: { 'es-CO': link('item') } }),
    entry('item', 'item'),
  ]);
  const exists = new Set(['banner', 'slide']);

  test('si desmarcas la entry que elegiste, queda igual (KEEP) y lo que cuelga no se crea', () => {
    const actions = classifyTree(['banner'], tree, exists, new Set());
    assert.equal(actions.get('banner'), ACTION.KEEP);
    assert.equal(actions.get('slide'), ACTION.REUSE);
    assert.equal(actions.get('item'), ACTION.ORPHAN);
  });

  test('si marcas un hijo, se actualiza y se crean sus hijos que faltan', () => {
    const actions = classifyTree(['banner'], tree, exists, new Set(['slide']));
    assert.equal(actions.get('banner'), ACTION.KEEP);
    assert.equal(actions.get('slide'), ACTION.UPDATE);
    assert.equal(actions.get('item'), ACTION.CREATE);
  });

  test('padre e hijo marcados: los dos se actualizan', () => {
    const actions = classifyTree(['banner'], tree, exists, new Set(['banner', 'slide']));
    assert.equal(actions.get('banner'), ACTION.UPDATE);
    assert.equal(actions.get('slide'), ACTION.UPDATE);
  });
});

describe('updateCandidates', () => {
  const ct = (id: string) => contentType(id, [field('title')]);
  const analysis = analysisOf({
    rootIds: ['banner', 'igual'],
    entries: [
      entry('banner', 'banner', { title: { 'es-CO': 'Nuevo' }, slide: { 'es-CO': link('slide') } }),
      entry('slide', 'slide', { title: { 'es-CO': 'Slide editado' } }),
      entry('igual', 'banner', { title: { 'es-CO': 'Igual' } }),
    ],
    dstEntries: [
      entry('banner', 'banner', { title: { 'es-CO': 'Viejo' } }),
      entry('slide', 'slide', { title: { 'es-CO': 'Slide' } }),
      entry('igual', 'banner', { title: { 'es-CO': 'Igual' } }),
    ],
    srcCTs: [ct('banner'), ct('slide')],
    dstCTs: [ct('banner'), ct('slide')],
  });

  test('lista padres e hijos que ya existen y cambiaron; no las que están iguales', () => {
    const candidates = updateCandidates(analysis);
    assert.deepEqual(
      candidates.map((c) => [c.id, c.isRoot, c.fields.map((f) => f.id)]),
      [
        ['banner', true, ['title']],
        ['slide', false, ['title']],
      ],
    );
  });

  test('por defecto se actualizan solo las que elegiste', () => {
    assert.deepEqual([...defaultUpdates(updateCandidates(analysis))], ['banner']);
  });
});

describe('buildPlan: solo apariencia del editor', () => {
  test('una entry sin cambios no se escribe, pero se puede copiar la apariencia de su modelo (help text)', () => {
    const imagen = contentType('imagen', [field('title')]);
    const analysis = analysisOf({
      rootIds: ['img'],
      entries: [entry('img', 'imagen', { title: { 'es-CO': 'Foto' } })],
      dstEntries: [entry('img', 'imagen', { title: { 'es-CO': 'Foto' } })],
      srcCTs: [imagen],
      dstCTs: [imagen],
    });
    const actions = classifyTree(analysis.rootIds, analysis.tree, analysis.existsInDst, new Set());
    const plan = buildPlan(
      { ...analysis, actions },
      {
        withAssets: false,
        picked: [
          {
            kind: 'editor',
            ctId: 'imagen',
            editor: { fieldId: 'title', parts: ['helpText'], helpText: {}, widget: {}, settings: [] },
          },
        ],
      },
    );
    assert.deepEqual(plan.entries, []);
    assert.deepEqual([...(plan.editorFields.get('imagen') ?? [])], ['title']);
  });
});
