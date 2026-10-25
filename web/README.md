# web — 震源球デコーダー（ブラウザ版）

Vanilla JS + Canvas 2D。外部ライブラリ・ビルド不要。

- 公開ページ: https://masauehr.github.io/beachball_decoder/（main への push で自動更新）
- 開く: `index.html` をブラウザで開く（サーバー不要）。または `python3 -m http.server -d web 8000` → http://localhost:8000
- 3D の図（お椀・球面・断層ブロック）はドラッグ（タッチ可）または矢印キーで回転。②③は連動。
- URL の `#s=30&d=45&r=90`（走向・傾斜・すべり角）で状態を共有できる。
- テスト: `node --test web/test`（Python 版との照合 `golden.json`。再生成は `PYTHONPATH=. .venv/bin/python tools/make_golden.py`）

構成: `js/fault.js`（断層計算）/ `js/draw.js`（描画）/ `js/app.js`（画面の組み立て）
