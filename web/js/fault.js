/* 断層パラメータ・モーメントテンソル・節面・P/T軸の相互変換（beachball_decoder/fault.py の移植）
 * 座標系は NED（x=北, y=東, z=下）。規約は fault.py の冒頭コメントと同じ。
 * ブラウザでは window.BB.fault、Node では module.exports として使う。 */
(function (root) {
  const D2R = Math.PI / 180;
  const R2D = 180 / Math.PI;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const unit = (a) => scale(a, 1 / norm(a));
  const mod = (x, m) => ((x % m) + m) % m;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  /** 走向・傾斜・すべり角 → 上盤向き法線 n とすべり方向 d（NED 単位ベクトル） */
  function sdrToND(strike, dip, rake) {
    const phi = strike * D2R, del = dip * D2R, lam = rake * D2R;
    const s = [Math.cos(phi), Math.sin(phi), 0];
    const dd = [-Math.sin(phi) * Math.cos(del), Math.cos(phi) * Math.cos(del), Math.sin(del)];
    const d = sub(scale(s, Math.cos(lam)), scale(dd, Math.sin(lam)));
    const n = scale(cross(s, dd), -1);
    return [n, d];
  }

  /** 法線 n・すべり方向 d → [走向, 傾斜, すべり角]（n は上向き成分を持つ側に正規化） */
  function ndToSDR(n, d) {
    if (n[2] > 1e-12) { n = scale(n, -1); d = scale(d, -1); }
    const dip = Math.acos(clamp(-n[2], -1, 1));
    const phi = Math.atan2(-n[0], n[1]);
    const s = [Math.cos(phi), Math.sin(phi), 0];
    const dd = [-Math.sin(phi) * Math.cos(dip), Math.cos(phi) * Math.cos(dip), Math.sin(dip)];
    const lam = Math.atan2(-dot(d, dd), dot(d, s));
    let rake = lam * R2D;
    if (rake <= -180) rake += 360;
    return [mod(phi * R2D, 360), dip * R2D, rake];
  }

  const outer = (a, b) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i] * b[j]));
  const addM = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));

  function momentTensor(strike, dip, rake) {
    const [n, d] = sdrToND(strike, dip, rake);
    return addM(outer(n, d), outer(d, n));
  }

  function auxPlane(strike, dip, rake) {
    const [n, d] = sdrToND(strike, dip, rake);
    return ndToSDR(d, n);
  }

  /** 対称 3x3 の固有値分解（Jacobi 法）。固有値の昇順に [値, ベクトル] を返す。 */
  function eigSym(M) {
    const A = M.map((r) => r.slice());
    const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let sweep = 0; sweep < 60; sweep++) {
      let off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
      if (off < 1e-14) break;
      for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
    return [0, 1, 2].map((i) => [A[i][i], [V[0][i], V[1][i], V[2][i]]]).sort((a, b) => a[0] - b[0]);
  }

  /** ベクトル → [方位角, 沈み込み角]（下向きに正規化） */
  function trendPlunge(v) {
    if (v[2] < 0) v = scale(v, -1);
    return [mod(Math.atan2(v[1], v[0]) * R2D, 360), Math.asin(clamp(v[2], -1, 1)) * R2D];
  }

  function axesOf(M) {
    const e = eigSym(M); // 最小=P, 中間=B, 最大=T
    return { p: trendPlunge(e[0][1]), b: trendPlunge(e[1][1]), t: trendPlunge(e[2][1]) };
  }

  /** すべり角から断層タイプ（日本語名とキー） */
  function classify(rake) {
    const r = mod(rake + 180, 360) - 180;
    const sinR = Math.sin(r * D2R), cosR = Math.cos(r * D2R);
    if (Math.abs(sinR) >= Math.sin(67.5 * D2R)) return sinR > 0 ? ['逆断層', 'thrust'] : ['正断層', 'normal'];
    const lateral = cosR > 0 ? '左横ずれ' : '右横ずれ';
    if (Math.abs(sinR) <= Math.sin(22.5 * D2R)) return [lateral + '断層', cosR > 0 ? 'strike_left' : 'strike_right'];
    const base = sinR > 0 ? '逆断層' : '正断層';
    return [lateral + '成分を伴う' + base, 'oblique_' + (sinR > 0 ? 'thrust' : 'normal')];
  }

  function makeMechanism(a, b, M) {
    const ax = axesOf(M);
    return { planeA: a, planeB: b, moment: M, pAxis: ax.p, tAxis: ax.t, bAxis: ax.b,
      faultType: classify(a[2]), faultTypeB: classify(b[2]) };
  }

  function fromSDR(strike, dip, rake) {
    if (!(dip >= 0 && dip <= 90)) throw new Error('傾斜は 0〜90 度で指定してください');
    let r = mod(rake + 180, 360) - 180;
    if (r === -180) r = 180;
    const a = [mod(strike, 360), dip, r];
    return makeMechanism(a, auxPlane(a[0], a[1], a[2]), momentTensor(a[0], a[1], a[2]));
  }

  /** GCMT/USGS 形式（r=上, t=南, p=東）→ NED の 3x3 */
  function useToNed(mrr, mtt, mpp, mrt, mrp, mtp) {
    const mnn = mtt, mee = mpp, mdd = mrr, mnd = mrt, mde = -mrp, mne = -mtp;
    return [[mnn, mne, mnd], [mne, mee, mde], [mnd, mde, mdd]];
  }

  /** モーメントテンソル（USE）→ 最も近い二重couple成分の発震機構 */
  function fromMtUse(mrr, mtt, mpp, mrt, mrp, mtp) {
    let M = useToNed(mrr, mtt, mpp, mrt, mrp, mtp);
    const tr = (M[0][0] + M[1][1] + M[2][2]) / 3;
    M = M.map((r, i) => r.map((v, j) => v - (i === j ? tr : 0)));
    const e = eigSym(M);
    const pv = e[0][1], tv = e[2][1];
    const n = scale(add(tv, pv), 1 / Math.SQRT2);
    const d = scale(sub(tv, pv), 1 / Math.SQRT2);
    const a = ndToSDR(n, d);
    const b = ndToSDR(d, n);
    return makeMechanism(a, b, momentTensor(a[0], a[1], a[2]));
  }

  /** 方位 az・離陸角 takeoff（下向き鉛直から, ラジアン）の射線の P波初動の符号付き振幅（正=押し） */
  function pressure(M, az, takeoff) {
    const g = [Math.sin(takeoff) * Math.cos(az), Math.sin(takeoff) * Math.sin(az), Math.cos(takeoff)];
    let s = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s += g[i] * M[i][j] * g[j];
    return s;
  }

  const api = { D2R, R2D, dot, cross, norm, scale, add, sub, unit, mod, clamp, sdrToND, ndToSDR, momentTensor,
    auxPlane, eigSym, trendPlunge, axesOf, classify, fromSDR, fromMtUse, useToNed, pressure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.BB = root.BB || {}; root.BB.fault = api; }
})(typeof window !== 'undefined' ? window : globalThis);
