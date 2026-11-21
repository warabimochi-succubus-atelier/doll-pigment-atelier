// 調色の画面で使う計算（js/calc.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');

const { Calc, Color } = load();

const pcts = (items) => plain(items).map((x) => x.pct);

test('保存前の割合：比率を変えずに合計100%（整数）にそろえる', () => {
  // マニュアルの例：70 / 20 / 20 → 64 / 18 / 18
  assert.deepEqual(pcts(Calc.normalizeMix([{ paintId: 'a', pct: 70 }, { paintId: 'b', pct: 20 }, { paintId: 'c', pct: 20 }])), [64, 18, 18]);
  // 端数は、切り捨てで減った分の大きい絵具に足す（33.3 / 33.3 / 33.3 → 合計 100）
  const third = pcts(Calc.normalizeMix([{ pct: 1 }, { pct: 1 }, { pct: 1 }]));
  assert.equal(third.reduce((s, v) => s + v, 0), 100);
  assert.deepEqual([...third].sort(), [33, 33, 34]);
  // グラムで入れても比率はそのまま
  assert.deepEqual(pcts(Calc.normalizeMix([{ pct: 3 }, { pct: 1 }])), [75, 25]);
  // 0% の絵具は外す。すべて 0% なら空
  assert.deepEqual(plain(Calc.normalizeMix([{ paintId: 'a', pct: 0 }, { paintId: 'b', pct: 40 }])), [{ paintId: 'b', pct: 100 }]);
  assert.deepEqual(plain(Calc.normalizeMix([{ pct: 0 }])), []);
  // すでに 100% ならそのまま
  assert.deepEqual(pcts(Calc.normalizeMix([{ pct: 55 }, { pct: 45 }])), [55, 45]);
});

test('抽出色の平均は線形空間で取る', () => {
  // 黒と白の平均は、sRGB の 128 ではなく、線形で半分の明るさ（188）になる
  assert.deepEqual(plain(Calc.averageRgb([{ rgb: [0, 0, 0] }, { rgb: [255, 255, 255] }])), [188, 188, 188]);
  assert.deepEqual(plain(Calc.averageRgb([{ rgb: [217, 140, 140] }])), [217, 140, 140]);
});

test('外れた抽出色に印を付ける', () => {
  const pink = (id, d = 0) => ({ id, rgb: [217 + d, 140 + d, 140 - d] });
  // 近いピンク3色と、1色だけ緑
  const out = Calc.outliers([pink('a'), pink('b', 2), pink('c', -2), { id: 'g', rgb: [60, 160, 80] }]);
  assert.deepEqual([...out.keys()], ['g']);
  assert.ok(out.get('g') >= Calc.OUTLIER_DE);
  // 2色以下では印を付けない
  assert.equal(Calc.outliers([pink('a'), { id: 'g', rgb: [60, 160, 80] }]).size, 0);
  // 照明違いで色が均等に広がっているときは、両端にも印を付けない
  const spread = [0, 1, 2, 3].map((i) => ({ id: `s${i}`, rgb: [200 - i * 15, 140 - i * 10, 140 - i * 10] }));
  assert.equal(Calc.outliers(spread).size, 0);
});

test('2色だけのときは、離れていれば差を返す', () => {
  assert.equal(Calc.pairGap([{ rgb: [217, 140, 140] }, { rgb: [218, 141, 140] }]), 0);
  const gap = Calc.pairGap([{ rgb: [217, 140, 140] }, { rgb: [60, 160, 80] }]);
  assert.ok(Math.abs(gap - Color.dE00(Color.rgbToLab([217, 140, 140]), Color.rgbToLab([60, 160, 80]))) < 1e-9);
  assert.equal(Calc.pairGap([{ rgb: [0, 0, 0] }]), 0);
});

test('数値で指定した色を読み取る', () => {
  assert.deepEqual(plain(Calc.parseColorText('#D98C8C')), [217, 140, 140]);
  assert.deepEqual(plain(Calc.parseColorText('217, 140, 140')), [217, 140, 140]);
  assert.deepEqual(plain(Calc.parseColorText('rgb(217 140 140)')), [217, 140, 140]);
  assert.equal(Calc.parseColorText('256, 0, 0'), null);
  assert.equal(Calc.parseColorText('1, 2'), null);
  assert.equal(Calc.parseColorText('ピンク'), null);
});
