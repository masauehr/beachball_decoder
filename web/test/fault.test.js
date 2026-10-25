// JavaScript 版の計算が Python 版（golden.json）と一致するかを確かめる。実行: node --test web/test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../js/fault.js');

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf-8'));
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const angNear = (a, b, eps = 1e-6) => near(Math.abs((((a - b) % 360) + 540) % 360 - 180), 0, eps);

function sameMechanism(js, py) {
  js.planeA.forEach((v, i) => (i === 1 ? near(v, py.planeA[i]) : angNear(v, py.planeA[i])));
  js.planeB.forEach((v, i) => (i === 1 ? near(v, py.planeB[i]) : angNear(v, py.planeB[i])));
  js.moment.forEach((row, i) => row.forEach((v, j) => near(v, py.moment[i][j], 1e-9)));
  assert.strictEqual(js.faultType[0], py.faultType);
}

test('走向・傾斜・すべり角から Python 版と同じ結果になる', () => {
  for (const c of golden.sdr) {
    const m = F.fromSDR(...c.input);
    sameMechanism(m, c.mech);
    near(m.pAxis[1], c.mech.pAxis[1], 1e-5);
    near(m.tAxis[1], c.mech.tAxis[1], 1e-5);
    // 鉛直に近い軸は方位が不定なので、傾いた軸だけ方位を比べる
    // 水平に近い軸は向きが逆でも同じ軸なので、方位は 180° の差を許す
    for (const [js, py] of [[m.tAxis, c.mech.tAxis], [m.pAxis, c.mech.pAxis]]) {
      if (py[1] >= 85) continue;
      if (py[1] < 1e-6) near(Math.sin((js[0] - py[0]) * F.D2R), 0, 1e-6);
      else angNear(js[0], py[0], 1e-4);
    }
  }
});

test('P波初動の符号付き振幅が Python 版と一致する', () => {
  for (const c of golden.sdr) {
    const m = F.fromSDR(...c.input);
    for (const [az, tk, v] of c.pressure) near(F.pressure(m.moment, az, tk), v, 1e-9);
  }
});

test('モーメントテンソルから同じ節面（テンソル）が復元できる', () => {
  for (const c of golden.mt) {
    const m = F.fromMtUse(...c.input);
    m.moment.forEach((row, i) => row.forEach((v, j) => near(v, c.mech.moment[i][j], 1e-7)));
  }
});

test('補助面の補助面は元に戻り、テンソルは同じ', () => {
  for (const sdr of [[0, 45, 90], [123, 35, 40], [310, 70, -140]]) {
    const b = F.auxPlane(...sdr);
    const back = F.auxPlane(...b);
    angNear(back[0], sdr[0]); near(back[1], sdr[1]); angNear(back[2], sdr[2]);
    const m1 = F.momentTensor(...sdr), m2 = F.momentTensor(...b);
    m1.forEach((r, i) => r.forEach((v, j) => near(v, m2[i][j], 1e-9)));
  }
});

test('逆断層は中心が黒、正断層は中心が白（鉛直下向きの射線）', () => {
  assert.ok(F.pressure(F.fromSDR(0, 45, 90).moment, 0, 0) > 0);
  assert.ok(F.pressure(F.fromSDR(0, 45, -90).moment, 0, 0) < 0);
});

test('断層タイプの判定', () => {
  const key = (r) => F.classify(r)[1];
  assert.strictEqual(key(90), 'thrust');
  assert.strictEqual(key(-90), 'normal');
  assert.strictEqual(key(0), 'strike_left');
  assert.strictEqual(key(180), 'strike_right');
  assert.strictEqual(key(45), 'oblique_thrust');
  assert.strictEqual(key(-135), 'oblique_normal');
});

test('傾斜が範囲外ならエラー', () => {
  assert.throws(() => F.fromSDR(0, 120, 0));
});
