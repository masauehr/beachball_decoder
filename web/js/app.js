/* 画面の組み立て: 入力 → 発震機構 → 各 canvas の描画。3D はドラッグで回転する。 */
(function () {
  const F = BB.fault, D = BB.draw;
  const $ = (id) => document.getElementById(id);
  const PRESETS = { thrust: [30, 45, 90], normal: [30, 60, -90], strike_left: [45, 90, 0], strike_right: [45, 90, 180],
    oblique: [30, 60, 45] };
  const DEFAULT_VIEW = { elev: 30, azim: -90 };

  const state = { sdr: PRESETS.thrust.slice(), mech: null, shell: { ...DEFAULT_VIEW }, blockA: null, blockB: null };
  const canvases = {
    flat: $('cFlat'), bowl: $('cBowl'), sphere: $('cSphere'), blockA: $('cBlockA'), blockB: $('cBlockB'), map: $('cMap'),
  };

  function fit(cv) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(cv.clientWidth)), h = Math.max(1, Math.round(cv.clientHeight));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  let queued = false;
  function redraw(which) {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; drawAll(which); });
  }

  function drawAll(which) {
    const m = state.mech;
    if (!m) return;
    const all = !which;
    if (all) { const c = fit(canvases.flat); D.drawFlat(c.ctx, c.w, c.h, m, c.dpr); }
    if (all || which === 'shell') {
      let c = fit(canvases.bowl); D.drawShell(c.ctx, c.w, c.h, m, state.shell, 'bowl');
      c = fit(canvases.sphere); D.drawShell(c.ctx, c.w, c.h, m, state.shell, 'sphere');
    }
    if (all || which === 'blockA') { const c = fit(canvases.blockA); D.drawBlock(c.ctx, c.w, c.h, m.planeA, state.blockA); }
    if (all || which === 'blockB') { const c = fit(canvases.blockB); D.drawBlock(c.ctx, c.w, c.h, m.planeB, state.blockB); }
    if (all) { const c = fit(canvases.map); D.drawMap(c.ctx, c.w, c.h, m, c.dpr); }
  }

  function setMechanism(mech, sdr) {
    state.mech = mech;
    if (sdr) state.sdr = sdr;
    state.blockA = D.defaultBlockView(mech.planeA);
    state.blockB = D.defaultBlockView(mech.planeB);
    const s = D.summary(mech);
    $('vTitle').textContent = `この地震の断層タイプ: ${s.title}`;
    $('vExplain').textContent = s.explain;
    $('vPlaneA').textContent = s.planeA; $('vPlaneB').textContent = s.planeB;
    $('vP').textContent = s.pAxis; $('vT').textContent = s.tAxis;
    redraw();
  }

  function syncInputs() {
    ['strike', 'dip', 'rake'].forEach((k, i) => { $(k).value = state.sdr[i]; $(k + 'N').value = state.sdr[i]; });
  }

  function applySDR(sdr, fromHash) {
    try {
      setMechanism(F.fromSDR(...sdr), sdr);
      syncInputs();
      if (!fromHash) history.replaceState(null, '', `#s=${sdr[0]}&d=${sdr[1]}&r=${sdr[2]}`);
    } catch (e) { /* 範囲外の入力は無視する */ }
  }

  function readInputs(fromNumber) {
    const v = ['strike', 'dip', 'rake'].map((k) => parseFloat($(k + (fromNumber ? 'N' : '')).value));
    if (v.some((x) => Number.isNaN(x))) return null;
    return [v[0], F.clamp(v[1], 0, 90), v[2]];
  }
  ['strike', 'dip', 'rake'].forEach((k) => {
    $(k).addEventListener('input', () => { const v = readInputs(false); if (v) applySDR(v); });
    $(k + 'N').addEventListener('input', () => { const v = readInputs(true); if (v) applySDR(v); });
  });
  document.querySelectorAll('[data-preset]').forEach((b) =>
    b.addEventListener('click', () => applySDR(PRESETS[b.dataset.preset].slice())));

  // モーメントテンソル入力
  const mtNames = ['Mrr', 'Mtt', 'Mpp', 'Mrt', 'Mrp', 'Mtp'], mtInit = [1.7, -0.3, -1.4, 0.5, -0.2, 0.9];
  $('mtFields').innerHTML = mtNames.map((n, i) =>
    `<label>${n}<input type="number" step="any" id="mt${i}" value="${mtInit[i]}"></label>`).join('');
  $('mtApply').addEventListener('click', () => {
    const v = mtNames.map((_, i) => parseFloat($('mt' + i).value));
    if (v.some(Number.isNaN)) { $('mtMsg').textContent = '数値を入力してください'; return; }
    const m = F.fromMtUse(...v);
    $('mtMsg').textContent = `最も近い二重couple成分: ${m.faultType[0]}`;
    const a = m.planeA.map((x) => Math.round(x * 10) / 10);
    setMechanism(m, a);
    syncInputs();
    history.replaceState(null, '', location.pathname);
  });

  // ドラッグで回転（マウス・タッチ共通）。②③は同じ視点で連動する。
  function makeDraggable(cv, getView, onChange) {
    let last = null;
    cv.addEventListener('pointerdown', (e) => { last = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!last) return;
      const v = getView();
      v.azim -= (e.clientX - last[0]) * 0.6;
      v.elev = F.clamp(v.elev + (e.clientY - last[1]) * 0.6, -89, 89);
      last = [e.clientX, e.clientY];
      onChange();
    });
    const end = () => { last = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('keydown', (e) => {
      const v = getView(), step = 8;
      const k = { ArrowLeft: () => (v.azim += step), ArrowRight: () => (v.azim -= step),
        ArrowUp: () => (v.elev = F.clamp(v.elev - step, -89, 89)), ArrowDown: () => (v.elev = F.clamp(v.elev + step, -89, 89)) }[e.key];
      if (k) { e.preventDefault(); k(); onChange(); }
    });
    cv.tabIndex = 0;
  }
  makeDraggable(canvases.bowl, () => state.shell, () => redraw('shell'));
  makeDraggable(canvases.sphere, () => state.shell, () => redraw('shell'));
  makeDraggable(canvases.blockA, () => state.blockA, () => redraw('blockA'));
  makeDraggable(canvases.blockB, () => state.blockB, () => redraw('blockB'));
  $('resetView').addEventListener('click', () => { state.shell = { ...DEFAULT_VIEW }; redraw('shell'); });

  window.addEventListener('resize', () => redraw());

  // URL の #s=走向&d=傾斜&r=すべり角 から復元
  function fromHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const v = [p.get('s'), p.get('d'), p.get('r')].map(parseFloat);
    return v.some(Number.isNaN) ? null : v;
  }
  applySDR(fromHash() || PRESETS.thrust.slice(), true);
  window.addEventListener('hashchange', () => { const v = fromHash(); if (v) applySDR(v, true); });
})();
