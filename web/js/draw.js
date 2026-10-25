/* Canvas 2D での描画（beachball_decoder/render.py の移植）。依存ライブラリなし。
 * 3D は直交投影で自前に描く。お椀・球面は「見える側の面だけ」を描くので奥行きの並べ替えは不要。 */
(function (root) {
  const F = root.BB.fault;
  const { D2R, dot, cross, scale, add, sub, unit, pressure } = F;

  const COL = { fw: '#9dc3e6', hw: '#f4b183', up: '#e8a3a3', down: '#a3c0e8', red: '#c0392b', blue: '#2e86c1',
    hwDark: '#b03a00', fwDark: '#1f4e79' };

  // ---- カメラ（matplotlib の elev/azim と同じ規約。座標は 東・北・上） ----
  function camera(elev, azim) {
    const e = elev * D2R, a = azim * D2R;
    return {
      t: [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)], // 視点の向き（カメラ側）
      r: [-Math.sin(a), Math.cos(a), 0],
      u: [-Math.sin(e) * Math.cos(a), -Math.sin(e) * Math.sin(a), Math.cos(e)],
    };
  }
  function proj(p, cam, cx, cy, s) {
    return [cx + dot(p, cam.r) * s, cy - dot(p, cam.u) * s];
  }
  const sphereXYZ = (az, t, r = 1) => [r * Math.sin(t) * Math.sin(az), r * Math.sin(t) * Math.cos(az), -r * Math.cos(t)];
  const nedToEnu = (v) => [v[1], v[0], -v[2]];

  function clear(ctx, W, H) { ctx.clearRect(0, 0, W, H); }

  function label(ctx, text, x, y, o = {}) {
    ctx.save();
    ctx.font = `${o.bold === false ? '' : 'bold '}${o.size || 14}px system-ui, "Hiragino Sans", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.halo) { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(text, x, y); }
    ctx.fillStyle = o.color || '#111';
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function marker(ctx, name, x, y, fill) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = COL.blue; ctx.stroke();
    ctx.restore();
    label(ctx, name, x, y, { color: COL.blue, size: 12 });
  }

  function badge(ctx, text, x, y) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, 11, 0, 2 * Math.PI);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = COL.red; ctx.stroke();
    ctx.restore();
    label(ctx, text, x, y, { color: COL.red, size: 13 });
  }

  /** 節面（大円）の点列（NED の単位ベクトル）。下向き半分だけ、または全周を返す。 */
  function greatCircle(plane, lowerOnly) {
    const [n] = F.sdrToND(...plane);
    let u = cross(n, [0, 0, 1]);
    u = F.norm(u) < 1e-9 ? [1, 0, 0] : unit(u);
    let v = cross(n, u);
    if (v[2] < 0) v = scale(v, -1); // 下半分を t∈[0,π] の連続区間にする（弦で結ばれるのを防ぐ）
    const pts = [];
    for (let i = 0; i <= 720; i++) {
      const t = (i / 720) * 2 * Math.PI;
      if (lowerOnly && t > Math.PI + 1e-9) break; // 下半分は t∈[0,π]（2π 側の始点と結ばれる弦を防ぐ）
      const g = add(scale(u, Math.cos(t)), scale(v, Math.sin(t)));
      if (!lowerOnly || g[2] >= -1e-9) pts.push(g);
    }
    return pts;
  }
  const nedToView = (g, r = 1) => [g[1] * r, g[0] * r, -g[2] * r]; // NED → 東北上

  /** 見える点だけの連続区間ごとに線を引く */
  function strokeVisible(ctx, pts, vis, toXY, style) {
    ctx.save();
    ctx.strokeStyle = style.color; ctx.lineWidth = style.width; ctx.globalAlpha = style.alpha || 1;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    let open = false;
    ctx.beginPath();
    for (const p of pts) {
      if (vis(p)) {
        const [x, y] = toXY(p);
        if (!open) { ctx.moveTo(x, y); open = true; } else ctx.lineTo(x, y);
      } else open = false;
    }
    ctx.stroke();
    ctx.restore();
  }

  // ---- ① 平らな震源球（下半球・等面積投影） ----
  const flatCache = new Map();
  function flatImage(M, N) {
    const key = JSON.stringify(M) + N;
    if (flatCache.has(key)) return flatCache.get(key);
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const c = cv.getContext('2d');
    const img = c.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N) * 2 - 1, y = 1 - ((j + 0.5) / N) * 2;
      const rho = Math.hypot(x, y);
      const k = (j * N + i) * 4;
      if (rho > 1) { img.data[k + 3] = 0; continue; }
      const v = pressure(M, Math.atan2(x, y), 2 * Math.asin(rho / Math.SQRT2));
      const g = v > 0 ? 34 : 255;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = g; img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    if (flatCache.size > 6) flatCache.clear();
    flatCache.set(key, cv);
    return cv;
  }
  function projectFlat(trend, plunge) {
    const tk = (90 - plunge) * D2R, rho = Math.SQRT2 * Math.sin(tk / 2), az = trend * D2R;
    return [rho * Math.sin(az), rho * Math.cos(az)];
  }

  function drawFlat(ctx, W, H, mech, dpr) {
    clear(ctx, W, H);
    const R = Math.min(W, H) * 0.4, cx = W / 2, cy = H / 2 + R * 0.04;
    const N = Math.max(200, Math.round(2 * R * dpr));
    ctx.drawImage(flatImage(mech.moment, N), cx - R, cy - R, 2 * R, 2 * R);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.lineWidth = 2.5; ctx.strokeStyle = '#111'; ctx.stroke();
    const toXY = (g) => {
      const tk = Math.acos(F.clamp(g[2], -1, 1)), rho = Math.SQRT2 * Math.sin(tk / 2), az = Math.atan2(g[1], g[0]);
      return [cx + R * rho * Math.sin(az), cy - R * rho * Math.cos(az)];
    };
    for (const plane of [mech.planeA, mech.planeB]) {
      strokeVisible(ctx, greatCircle(plane, true), () => true, toXY, { color: COL.red, width: 2.5 });
    }
    [['A', mech.planeA], ['B', mech.planeB]].forEach(([name, pl]) => {
      const [px, py] = projectFlat((pl[0] + 90) % 360, 90 - pl[1]);
      badge(ctx, name, cx + R * px, cy - R * py);
    });
    [['P', mech.pAxis, '#fff'], ['T', mech.tAxis, '#222']].forEach(([name, ax, fill]) => {
      const [px, py] = projectFlat(ax[0], ax[1]);
      marker(ctx, name, cx + R * px, cy - R * py, fill);
    });
    label(ctx, 'N', cx, cy - R - 24, { size: 15 });
    ctx.beginPath(); ctx.moveTo(cx, cy - R - 4); ctx.lineTo(cx - 5, cy - R - 13); ctx.lineTo(cx + 5, cy - R - 13);
    ctx.closePath(); ctx.fillStyle = '#111'; ctx.fill();
  }

  // ---- ②③ お椀・球面 ----
  const meshCache = new Map();
  function getMesh(mode, M) {
    const key = mode + JSON.stringify(M);
    if (meshCache.has(key)) return meshCache.get(key);
    const na = 144, nt = mode === 'bowl' ? 45 : 72, tMax = mode === 'bowl' ? Math.PI / 2 : Math.PI;
    const q = na * nt;
    const verts = new Float32Array(q * 12), center = new Float32Array(q * 3);
    const black = new Uint8Array(q), upper = new Uint8Array(q);
    let k = 0;
    for (let j = 0; j < nt; j++) for (let i = 0; i < na; i++, k++) {
      const a0 = (i / na) * 2 * Math.PI, a1 = ((i + 1) / na) * 2 * Math.PI;
      const t0 = (j / nt) * tMax, t1 = ((j + 1) / nt) * tMax;
      const ac = (a0 + a1) / 2, tc = (t0 + t1) / 2;
      [[a0, t0], [a1, t0], [a1, t1], [a0, t1]].forEach(([a, t], m) => verts.set(sphereXYZ(a, t), k * 12 + m * 3));
      center.set(sphereXYZ(ac, tc), k * 3);
      black[k] = pressure(M, ac, tc) > 0 ? 1 : 0;
      upper[k] = tc > Math.PI / 2 ? 1 : 0;
    }
    const mesh = { q, verts, center, black, upper };
    if (meshCache.size > 4) meshCache.clear();
    meshCache.set(key, mesh);
    return mesh;
  }

  function shade(isBlack, light, isUpper) {
    let g = isBlack ? 0.12 * light : 0.96 - 0.4 * (1 - light);
    if (isUpper) g += (0.86 - g) * 0.55;
    const v = Math.round(F.clamp(g, 0, 1) * 255);
    return `rgb(${v},${v},${v})`;
  }

  /** mode: 'bowl'（下半球のお椀）または 'sphere'（球面全体）。視点が下からなら外側を見る。 */
  function drawShell(ctx, W, H, mech, view, mode) {
    clear(ctx, W, H);
    const cam = camera(view.elev, view.azim);
    const inside = mode === 'bowl' && view.elev > 0;
    const s = Math.min(W, H) * (mode === 'bowl' ? 0.34 : 0.34);
    const cy0 = mode === 'bowl' ? H / 2 + s * 0.15 * Math.max(0, 1 - view.elev / 90) : H / 2;
    const cx = W / 2;
    const P = (p) => proj(p, cam, cx, cy0, s);
    const seeIn = (p) => (inside ? dot(p, cam.t) < 0 : dot(p, cam.t) > 0);
    const mesh = getMesh(mode, mech.moment);
    const t = cam.t;
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.7;
    for (let q = 0; q < mesh.q; q++) {
      const d = mesh.center[q * 3] * t[0] + mesh.center[q * 3 + 1] * t[1] + mesh.center[q * 3 + 2] * t[2];
      if (inside ? d >= 0 : d <= 0) continue;
      const color = shade(mesh.black[q], 0.78 + 0.22 * Math.abs(d), mode === 'sphere' && mesh.upper[q]);
      ctx.beginPath();
      for (let m = 0; m < 4; m++) {
        const o = q * 12 + m * 3;
        const x = cx + (mesh.verts[o] * cam.r[0] + mesh.verts[o + 1] * cam.r[1]) * s;
        const y = cy0 - (mesh.verts[o] * cam.u[0] + mesh.verts[o + 1] * cam.u[1] + mesh.verts[o + 2] * cam.u[2]) * s;
        if (m === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fillStyle = color; ctx.strokeStyle = color; ctx.fill(); ctx.stroke();
    }
    // 経線・緯線
    const rg = inside ? 0.997 : 1.003, tMax = mode === 'bowl' ? Math.PI / 2 : Math.PI;
    const grid = [];
    for (let a = 0; a < 360; a += 30) {
      const pts = []; for (let i = 0; i <= 60; i++) pts.push(sphereXYZ(a * D2R, (i / 60) * tMax, rg)); grid.push(pts);
    }
    (mode === 'bowl' ? [15, 30, 45, 60, 75] : [30, 60, 120, 150]).forEach((tt) => {
      const pts = []; for (let i = 0; i <= 120; i++) pts.push(sphereXYZ((i / 120) * 2 * Math.PI, tt * D2R, rg)); grid.push(pts);
    });
    grid.forEach((pts) => strokeVisible(ctx, pts, seeIn, P, { color: '#888', width: 0.6, alpha: 0.7 }));
    // 赤道
    const eq = []; for (let i = 0; i <= 180; i++) eq.push([Math.sin((i / 180) * 2 * Math.PI) * 1.005, Math.cos((i / 180) * 2 * Math.PI) * 1.005, 0]);
    strokeVisible(ctx, eq, mode === 'bowl' ? () => true : seeIn, P, { color: '#111', width: 2.6 });
    // 節面
    for (const plane of [mech.planeA, mech.planeB]) {
      const r = inside ? 0.995 : 1.006;
      const pts = greatCircle(plane, mode === 'bowl').map((g) => nedToView(g, r));
      strokeVisible(ctx, pts, seeIn, P, { color: COL.red, width: 3.2 });
    }
    // P軸・T軸
    [['P', mech.pAxis, '#fff'], ['T', mech.tAxis, '#222']].forEach(([name, ax, fill]) => {
      const base = sphereXYZ(ax[0] * D2R, (90 - ax[1]) * D2R);
      const cands = mode === 'sphere' ? [scale(base, 1.01), scale(base, -1.01)] : [scale(base, inside ? 0.99 : 1.01)];
      cands.forEach((pos) => {
        if (seeIn(pos)) { const [x, y] = P(pos); marker(ctx, name, x, y, fill); }
      });
    });
    // 方位
    const dirs = [['N', [0, 1.22, 0.1]], ['E', [1.22, 0, 0.1]], ['S', [0, -1.22, 0.1]], ['W', [-1.22, 0, 0.1]]];
    if (mode === 'sphere') dirs.push(['上', [0, 0, 1.22]], ['下', [0, 0, -1.22]]);
    dirs.forEach(([name, p]) => {
      if (mode === 'sphere' && dot(p, cam.t) <= -0.35) return;
      const [x, y] = P(p); label(ctx, name, x, y, { size: 15, halo: true });
    });
  }

  // ---- ④⑤ 断層ブロック図 ----
  function clipPoly(poly, n, off) {
    const out = [];
    poly.forEach((cur, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length];
      const dc = dot(n, cur) - off, dp = dot(n, prev) - off;
      const cut = () => add(prev, scale(sub(cur, prev), dp / (dp - dc)));
      if (dc >= 0) { if (dp < 0) out.push(cut()); out.push(cur); } else if (dp >= 0) out.push(cut());
    });
    return out;
  }
  const BOX = [1.2, 1.2, 0.8];
  function boxFaces([hx, hy, hz]) {
    return [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]],
      [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]],
      [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]],
      [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]],
      [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]],
    ];
  }
  function blockPolys(plane) {
    const [nN, dN] = F.sdrToND(...plane);
    const n = nedToEnu(nN), d = nedToEnu(dN);
    const hw = [], fw = [];
    boxFaces(BOX).forEach((f) => {
      const a = clipPoly(f, n, 0), b = clipPoly(f, scale(n, -1), 0);
      if (a.length >= 3) hw.push(a);
      if (b.length >= 3) fw.push(b);
    });
    let u = cross(n, [0, 0, 1]);
    u = F.norm(u) < 1e-9 ? [1, 0, 0] : unit(u);
    const v = cross(n, u), big = 6;
    let cut = [add(scale(u, big), scale(v, big)), add(scale(u, -big), scale(v, big)),
      sub(scale(u, -big), scale(v, big)), sub(scale(u, big), scale(v, big))];
    for (let ax = 0; ax < 3; ax++) for (const sg of [1, -1]) {
      const e = [0, 0, 0]; e[ax] = -sg; cut = clipPoly(cut, e, -BOX[ax]);
    }
    return { hw, fw, cut, n, d };
  }
  function hexToRgb(h) { const v = parseInt(h.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
  function shadeColor(poly, hex) {
    const n = cross(sub(poly[1], poly[0]), sub(poly[2], poly[0]));
    const nn = F.norm(n);
    const light = unit([0.35, -0.45, 0.82]);
    const k = nn < 1e-12 ? 0.75 : 0.68 + 0.32 * Math.abs(dot(scale(n, 1 / nn), light));
    const [r, g, b] = hexToRgb(hex).map((c) => Math.round(c * Math.min(k, 1)));
    return `rgb(${r},${g},${b})`;
  }
  function arrow(ctx, a, b, color, width) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), h = width * 3.2;
    ctx.beginPath(); ctx.moveTo(b[0], b[1]);
    ctx.lineTo(b[0] - h * Math.cos(ang - 0.45), b[1] - h * Math.sin(ang - 0.45));
    ctx.lineTo(b[0] - h * Math.cos(ang + 0.45), b[1] - h * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  function defaultBlockView(plane) {
    const [nN] = F.sdrToND(...plane); const n = nedToEnu(nN);
    return { elev: 26, azim: Math.atan2(n[1], n[0]) / D2R - 30 };
  }

  function drawBlock(ctx, W, H, plane, view) {
    clear(ctx, W, H);
    const cam = camera(view.elev, view.azim);
    const s = Math.min(W, H) * 0.22, cx = W / 2, cy = H / 2;
    const P = (p) => proj(p, cam, cx, cy, s);
    const { hw, fw, cut, n, d } = blockPolys(plane);
    const shift = 0.3;
    const items = [];
    fw.concat([cut]).forEach((p) => items.push({ poly: p.map((q) => sub(q, scale(d, shift))), c: shadeColor(p, COL.fw) }));
    hw.concat([cut]).forEach((p) => items.push({ poly: p.map((q) => add(q, scale(d, shift))), c: shadeColor(p, COL.hw) }));
    const depth = (poly) => poly.reduce((acc, q) => acc + dot(q, cam.t), 0) / poly.length;
    items.sort((a, b) => depth(a.poly) - depth(b.poly)); // 奥から手前へ
    ctx.lineJoin = 'round';
    items.forEach(({ poly, c }) => {
      ctx.beginPath();
      poly.forEach((q, i) => { const [x, y] = P(q); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.closePath(); ctx.fillStyle = c; ctx.globalAlpha = 0.97; ctx.fill(); ctx.globalAlpha = 1;
      ctx.lineWidth = 1; ctx.strokeStyle = '#333'; ctx.stroke();
    });
    // 動きの矢印（各ブロックの断層面の近くの上面に重ねる）
    const cen = cut.reduce((a, q) => add(a, q), [0, 0, 0]).map((v) => v / cut.length);
    [[1, COL.hwDark], [-1, COL.fwDark]].forEach(([sg, color]) => {
      let st = add(add(cen, scale(n, 0.55 * sg)), scale(d, shift * sg));
      st = [st[0], st[1], Math.min(st[2], BOX[2]) + 0.02];
      arrow(ctx, P(st), P(add(st, scale(d, sg * 1.0))), color, 4);
    });
    [[1, '上盤', COL.hwDark], [-1, '下盤', COL.fwDark]].forEach(([sg, name, color]) => {
      let pos = add(add(cen, scale(n, 1.45 * sg)), scale(d, shift * sg * 2));
      pos = [pos[0], pos[1], F.clamp(pos[2], -BOX[2], BOX[2] + 0.6) + 0.35];
      const [x, y] = P(pos); label(ctx, name, x, y, { color, size: 15, halo: true });
    });
    // 北
    const nx = dot([0, 1, 0], cam.r), ny = -dot([0, 1, 0], cam.u); // 北が画面上で向かう方向
    const a0 = [W - 46, 46], a1 = [a0[0] + nx * 30, a0[1] + ny * 30];
    arrow(ctx, a0, a1, '#111', 2.5);
    label(ctx, 'N', a1[0] + nx * 12, a1[1] + ny * 12, { size: 14 });
  }

  // ---- ⑥ 地表の初動マップ ----
  function drawMap(ctx, W, H, mech, dpr) {
    clear(ctx, W, H);
    const half = 30, depth = 10, m = 6;
    const S = Math.min(W, H) - 2 * m, x0 = (W - S) / 2, y0 = (H - S) / 2;
    const N = Math.max(160, Math.round(S * dpr * 0.6));
    const cv = document.createElement('canvas'); cv.width = cv.height = N;
    const c = cv.getContext('2d'), img = c.createImageData(N, N);
    const up = hexToRgb(COL.up), dn = hexToRgb(COL.down);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = ((i + 0.5) / N * 2 - 1) * half, y = (1 - (j + 0.5) / N * 2) * half;
      const v = pressure(mech.moment, Math.atan2(x, y), Math.atan2(Math.hypot(x, y), depth));
      const col = v > 0 ? up : dn, k = (j * N + i) * 4;
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    ctx.drawImage(cv, x0, y0, S, S);
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, S, S);
    const toXY = (x, y) => [x0 + (x / half + 1) / 2 * S, y0 + (1 - y / half) / 2 * S];
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, S, S); ctx.clip();
    [[mech.planeA, [], 'A'], [mech.planeB, [8, 6], 'B']].forEach(([pl, dash, name]) => {
      const sa = pl[0] * D2R, dx = Math.sin(sa), dy = Math.cos(sa), L = half * 1.5;
      ctx.setLineDash(dash); ctx.strokeStyle = COL.red; ctx.lineWidth = 2.5;
      const [ax, ay] = toXY(-L * dx, -L * dy), [bx, by] = toXY(L * dx, L * dy);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    });
    ctx.restore();
    ctx.setLineDash([]);
    [['A', mech.planeA], ['B', mech.planeB]].forEach(([name, pl]) => {
      const sa = pl[0] * D2R, [x, y] = toXY(0.82 * half * Math.sin(sa), 0.82 * half * Math.cos(sa));
      badge(ctx, name, x, y);
    });
    for (const r of [14, 24]) for (let k = 0; k < 8; k++) {
      const a = (45 * k + (r > 20 ? 22.5 : 0)) * D2R;
      const v = pressure(mech.moment, a, Math.atan2(r, depth));
      const [x, y] = toXY(r * Math.sin(a), r * Math.cos(a));
      label(ctx, v > 0 ? '↑' : '↓', x, y, { color: v > 0 ? '#8b1a1a' : COL.fwDark, size: 18 });
    }
    const [sx, sy] = toXY(0, 0);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = (i * 36 - 90) * D2R; ctx.lineTo(sx + r * Math.cos(a), sy + r * Math.sin(a)); }
    ctx.closePath(); ctx.fillStyle = '#ffeb3b'; ctx.fill(); ctx.strokeStyle = '#111'; ctx.lineWidth = 1.2; ctx.stroke();
    label(ctx, 'N ↑', x0 + 22, y0 + 16, { size: 14, halo: true });
  }

  // ---- 解説文 ----
  const EXPLAIN = {
    thrust: '逆断層: 上盤が下盤に乗り上げる動き。水平方向に押し縮められている場所で起こる（プレート境界の沈み込み帯など）。',
    normal: '正断層: 上盤が下盤に対してずり落ちる動き。水平方向に引き伸ばされている場所で起こる。',
    strike_left: '左横ずれ断層: 断層を挟んで向こう側が左へずれる。ほぼ水平方向にずれ、上下の動きは小さい。',
    strike_right: '右横ずれ断層: 断層を挟んで向こう側が右へずれる。ほぼ水平方向にずれ、上下の動きは小さい。',
    oblique_thrust: '斜めずれ: 乗り上げる動きに横ずれが加わっている。',
    oblique_normal: '斜めずれ: ずり落ちる動きに横ずれが加わっている。',
  };
  function axisText(name, [trend, plunge]) {
    if (plunge > 75) return `${name}軸: ほぼ鉛直`;
    const tilt = plunge < 15 ? 'ほぼ水平' : `水平から ${plunge.toFixed(0)}° 傾く`;
    return `${name}軸: 方位 ${trend.toFixed(0)}°、${tilt}`;
  }
  function summary(mech) {
    const f = (p) => `走向 ${p[0].toFixed(0)}° / 傾斜 ${p[1].toFixed(0)}° / すべり角 ${p[2].toFixed(0)}°`;
    return {
      title: mech.faultType[0],
      explain: EXPLAIN[mech.faultType[1]],
      planeA: `${f(mech.planeA)}（${mech.faultType[0]}）`,
      planeB: `${f(mech.planeB)}（${mech.faultTypeB[0]}）`,
      pAxis: axisText('P', mech.pAxis) + '（圧縮される向き）',
      tAxis: axisText('T', mech.tAxis) + '（引き伸ばされる向き）',
    };
  }

  root.BB.draw = { camera, drawFlat, drawShell, drawBlock, drawMap, defaultBlockView, summary, COL };
})(window);
