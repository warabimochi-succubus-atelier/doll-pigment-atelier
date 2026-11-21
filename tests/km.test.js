// 混色と逆引き調色（js/km.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');

const { PaintDB, Color } = load();

const special = PaintDB.paints.find((p) => !p.mixable);
const [a, b] = PaintDB.STARTER_IDS.map((id) => PaintDB.byId[id]);

test('標準DB：id は重ならず、各ラインに白がある', () => {
  assert.equal(PaintDB.paints.length, 307);
  assert.equal(new Set(PaintDB.paints.map((p) => p.id)).size, 307);
  assert.equal(PaintDB.paints.filter((p) => p.mixable).length, 257);
  assert.equal(PaintDB.WHITE_IDS.length, PaintDB.lines.length);
  for (const p of PaintDB.paints) assert.ok(Color.parseHex(p.hex), `${p.id} の色`);
});

test('1色だけの予測は、その絵具の色になる', () => {
  const ev = PaintDB.evaluate([{ paintId: a.id, pct: 100 }]);
  assert.ok(Color.dE00(Color.rgbToLab(plain(ev.rgb)), a.lab) < 1);
  assert.equal(ev.skipped, 0);
});

test('計算対象外の絵具は予測に含めない', () => {
  const ev = PaintDB.evaluate([{ paintId: a.id, pct: 50 }, { paintId: special.id, pct: 50 }]);
  assert.equal(ev.skipped, 1);
  assert.equal(ev.hex, PaintDB.evaluate([{ paintId: a.id, pct: 50 }]).hex);
  assert.equal(PaintDB.evaluate([{ paintId: special.id, pct: 100 }]), null);
  assert.equal(PaintDB.evaluate([]), null);
});

test('逆引き調色：使える絵具だけで、最大4色・5%刻み・合計100%', () => {
  const ids = PaintDB.STARTER_IDS;
  const target = PaintDB.mixRgb([a, b], [3, 1]); // 実際に作れる色
  const cands = plain(PaintDB.reverse(plain(target), ids, 3));
  assert.equal(cands.length, 3);
  for (const c of cands) {
    assert.ok(c.items.length >= 1 && c.items.length <= 4);
    assert.ok(c.items.every((x) => ids.includes(x.paintId)));
    assert.ok(c.items.every((x) => x.pct % 5 === 0 && x.pct > 0));
    assert.equal(c.items.reduce((s, x) => s + x.pct, 0), 100);
  }
  assert.ok(cands[0].de < 1, `作れる色はほぼ再現できる（ΔE ${cands[0].de}）`);
});

test('逆引き調色：計算対象外の絵具は使わず、使える絵具がなければ候補なし', () => {
  const cands = plain(PaintDB.reverse([200, 150, 150], [special.id, a.id], 3));
  assert.ok(cands.every((c) => c.items.every((x) => x.paintId !== special.id)));
  assert.deepEqual(plain(PaintDB.reverse([200, 150, 150], [special.id], 3)), []);
});
