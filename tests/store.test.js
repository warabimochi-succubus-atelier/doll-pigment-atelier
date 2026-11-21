// 読み込んだデータの確認（js/store.js の cleanDb など）
// Node には IndexedDB がないので、Store はメモリだけで動く（プライベートブラウズと同じ）
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');

const { Store, PaintDB } = load();

const img = (id) => ({ id, name: `${id}.jpg`, type: 'image/jpeg', w: 10, h: 10, full: new Blob(['f']), thumb: new Blob(['t']) });

test('IndexedDB がないときは、メモリだけで動く', async () => {
  const boot = await Store.init();
  assert.equal(boot.ok, false);
  assert.equal(Store.available, false);
  assert.equal(Store.lost, null);
  assert.equal(Store.entries().length, 0);
});

test('バックアップを読み込むとき、壊れた値や危ない値をそろえる', async () => {
  const [p1, p2] = PaintDB.paints;
  const ok = await Store.replaceAll({
    entries: [
      { id: 'a1', name: '<b>チーク</b>', hex: '#e9a3a0', rating: 9, createdAt: 2,
        actual: [{ paintId: p1.id, pct: 150 }, { paintId: 'nope', pct: 50 }],
        refImages: [{ imageId: 'img1', name: 'ref' }, { imageId: 'missing', name: 'x' }],
        cond: { skin: '不明', medium: 'unknown', head: 'DDH-01' } },
      { id: 'a1', name: '同じ id', hex: 'E494A6', createdAt: 3 },           // id が重なる → 新しい id
      { id: 'bad id"><script>', name: '', hex: '#123456', createdAt: 1 },     // id に記号 → 新しい id、名称なし
      { id: 'c', name: '色がない', hex: 'red' },                              // HEX が読めない → 取り込まない
      null,
    ],
    owned: [p1.id, p2.id, 'nope', p1.id],
    runOut: [p2.id, PaintDB.paints[5].id], // 所持していない絵具の「切らしている」は外す
    lastMedium: 'unknown',
  }, [img('img1'), img('unused'), { id: 'no blob' }]);
  assert.equal(ok, true);

  const es = plain(Store.entries());
  assert.equal(es.length, 3);
  assert.deepEqual(es.map((e) => e.createdAt), [3, 2, 1], '新しい順');
  const a = es.find((e) => e.id === 'a1');
  assert.equal(a.name, '<b>チーク</b>', '名称は文字列のまま（表示するときにエスケープする）');
  assert.equal(a.hex, '#E9A3A0');
  assert.equal(a.rating, 5);
  assert.deepEqual(a.actual, [{ paintId: p1.id, pct: 100 }]);
  assert.deepEqual(a.refImages.map((r) => r.imageId), ['img1'], '見つからない画像の参照は外す');
  assert.deepEqual(a.cond, { head: 'DDH-01', skin: 'その他', brand: Store.DEFAULT_BRAND, medium: 'none' });

  const ids = es.map((e) => e.id);
  assert.equal(new Set(ids).size, 3, 'id が重ならない');
  assert.ok(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)), 'id は英数字だけ');
  assert.equal(es.find((e) => e.hex === '#123456').name, '（名称なし）');
  assert.equal(es.find((e) => e.hex === '#E494A6').createdAt, 3);

  assert.deepEqual(plain(Store.ownedIds()), [p1.id, p2.id]);
  assert.deepEqual(plain(Store.runOutIds()), [p2.id]);
  assert.equal(Store.lastMedium(), 'painting-medium');
  assert.equal(Store.imageCount(), 1, 'どこからも参照されない画像は取り込まない');
  assert.ok(Store.hasImage('img1'));
});

test('所持を外すと「切らしている」も外れる', async () => {
  const id = PaintDB.paints[0].id;
  await Store.setOwned(id, true);
  await Store.setRunOut(id, true);
  assert.equal(Store.isUsable(id), false);
  await Store.setOwned(id, false);
  assert.equal(Store.isRunOut(id), false);
  // 所持していない絵具は「切らしている」にできない
  await Store.setRunOut(id, true);
  assert.equal(Store.isRunOut(id), false);
});

test('すべて削除しても、絵具箱の設定は残る', async () => {
  const id = PaintDB.paints[1].id;
  await Store.setOwned(id, true);
  await Store.wipe();
  assert.equal(Store.entries().length, 0);
  assert.equal(Store.imageCount(), 0);
  assert.ok(Store.isOwned(id));
});
