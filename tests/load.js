// ブラウザ用のスクリプト（js/ のファイル）を、Node の vm で読み込む
// index.html と同じ順に読み、const で定義された Color・PaintDB・Store・Zip などを返す。
// ブラウザだけにある API のうち、テストで使うもの（Blob など）は Node のものを渡す
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = ['js/vendor/mixbox.js', 'js/color.js', 'js/paints-data.js', 'js/km.js', 'js/store.js', 'js/zip.js', 'js/calc.js'];

function load() {
  const ctx = vm.createContext({
    // 警告（IndexedDB がないときなど、テストでは想定どおりのもの）は出さない
    console: { log: console.log, error: console.error, warn: () => {} }, Blob, TextEncoder, TextDecoder, DecompressionStream, structuredClone, performance,
    navigator: {},
  });
  ctx.self = ctx; // mixbox.js は global（self）に mixbox を置く
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  const get = (name) => vm.runInContext(name, ctx);
  return { Color: get('Color'), PaintDB: get('PaintDB'), Store: get('Store'), Zip: get('Zip'), Calc: get('Calc'), ctx };
}

// vm の中で作った配列・オブジェクトは別の realm のものなので、比べる前に JSON で通常の値にする
const plain = (v) => JSON.parse(JSON.stringify(v));

module.exports = { load, plain };
