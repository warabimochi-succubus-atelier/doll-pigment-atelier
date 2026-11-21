// 色空間変換と CIEDE2000（js/color.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const { load, plain } = require('./load');

const { Color } = load();

test('HEX の読み取りと書き出し', () => {
  assert.deepEqual(plain(Color.parseHex('#D98C8C')), [217, 140, 140]);
  assert.deepEqual(plain(Color.parseHex('d98c8c')), [217, 140, 140]);
  assert.deepEqual(plain(Color.parseHex(' #abc ')), [170, 187, 204]);
  assert.equal(Color.parseHex('#12345'), null);
  assert.equal(Color.parseHex('#GGGGGG'), null);
  assert.equal(Color.parseHex(''), null);
  assert.equal(Color.toHex([217, 140, 140]), '#D98C8C');
  assert.equal(Color.toHex([0, 15, 255]), '#000FFF');
});

test('sRGB と線形・Lab の往復で色が変わらない', () => {
  for (const rgb of [[0, 0, 0], [255, 255, 255], [217, 140, 140], [12, 200, 90], [62, 42, 36]]) {
    assert.deepEqual(plain(Color.linearToRgb(Color.rgbToLinear(rgb))), rgb);
    assert.deepEqual(plain(Color.labToRgb(Color.rgbToLab(rgb))), rgb);
  }
  // 白は L=100, a=b=0
  const [L, a, b] = Color.rgbToLab([255, 255, 255]);
  assert.ok(Math.abs(L - 100) < 0.01 && Math.abs(a) < 0.01 && Math.abs(b) < 0.01);
});

// Sharma, Wu, Dalal (2005) の CIEDE2000 のテストデータから
test('CIEDE2000 が既知の値と一致する', () => {
  const cases = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [l1, l2, expected] of cases) {
    assert.ok(Math.abs(Color.dE00(l1, l2) - expected) < 1e-4, `${l1} / ${l2}: ${Color.dE00(l1, l2)} ≠ ${expected}`);
    assert.ok(Math.abs(Color.dE00(l2, l1) - expected) < 1e-4, '入れ替えても同じ');
  }
  assert.equal(Color.dE00([50, 10, 10], [50, 10, 10]), 0);
});
