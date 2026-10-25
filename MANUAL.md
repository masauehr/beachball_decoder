# MANUAL.md — beachball_decoder

震源球（ビーチボール図）を、直感的に理解できる図へ変換するソフトウェア。企画の全体と使い方は [README.md](README.md) を参照。

## 現状（2026-10-25）
- Phase 0〜2 実装済み（Python: numpy / matplotlib）。GitHub public（`masauehr/beachball_decoder`）。
- 入力: 走向・傾斜・すべり角 / モーメントテンソル（GCMT・USGS形式）/ 代表例（`--preset`）。
- 出力: 1枚の画像（震源球・下半球の立体図（お椀を斜めから）・節面A/Bそれぞれのブロック図・地表の初動マップ・日本語の解説文）。
- テスト50件（obspy の補助面・震源球の黒白と照合）。

## 実行
```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # 初回のみ
.venv/bin/python -m beachball_decoder --preset thrust -o out.png
.venv/bin/python -m pytest tests    # 要 requirements-dev.txt
```
システムの python3 は brew 更新で 3.14 になり matplotlib が無いので、専用 `.venv` を使う。

## 動作確認ノートブック
`notebooks/01_decoder_tour.ipynb`（カーネル: `beachball_decoder (.venv)`。未登録なら `.venv/bin/python -m ipykernel install --user --name beachball_decoder`）。
1準備 / 2数式（obspy照合）/ 3震源球5種 + obspy画素照合 / 4ブロック図 + 切断の数値チェック / 5地表マップ / 6全部入り / 7スライダー / 8モーメントテンソル入力。
全セル実行で確認済み（照合は5種すべて一致）。出力は消してコミットする。

## コード構成
- `beachball_decoder/fault.py`: 断層パラメータ ⇄ モーメントテンソル ⇄ 節面・P/T軸、断層タイプ判定（NED座標）
- `beachball_decoder/render.py`: 震源球・ブロック図・地表マップ・解説文・合成
- `beachball_decoder/cli.py`: コマンドライン

## 下半球の立体表示（`render.draw_hemisphere`）
平らな震源球は「下半球（お椀）を真上から見た図」。これを斜めから見た立体図を追加した。
- `inside=True`（既定）: 上からお椀の内側をのぞく。平らな図を傾けた見え方に近い。`inside=False`: 下から外側を見る（平らな図と左右が鏡像）。
- 描画は自前で面の向きを判定し、見える側の面だけを描く（mpl の奥行きの並べ替えは凹面で崩れるため）。節面は大円を解析的に求めて見える部分だけ引く。
- 真上（elev≈90）から見ると正射影になり、平らな震源球（等面積投影）とは周辺の縮み方が違う。
- ノートブック 3-2 節に、見る高さ・向きと走向/傾斜/すべり角のスライダーあり。

## 知見・落とし穴
- **黒（押し）の象限の中心付近に T軸、白（引き）に P軸**。名前と色が逆。企画時の README は逆に書いていた（修正済み）。
- 符号規約: M = n dᵀ + d nᵀ（n=上盤向き法線）、P波初動は γ·M·γ > 0 で「押し」。逆断層は中心が黒、正断層は中心が白、GCMT では逆断層が Mrr > 0。
- obspy の `beach([走向,傾斜,すべり角])` は近似楕円で描くため、厳密な等面積投影と節面付近でわずかにずれる。照合はテンソル入力の経路で行う。
- 垂直断層や rake=±180° は表現が複数ある（走向+180°・rake反転など）。比較はテンソルで行う。
- 節面A/Bのどちらが真の断層面かは初動だけでは決まらない。図でも両方を並べて示す。

## 未決・次にやること
- ブロック図の見やすさ（ラベルが矢印やブロックに重なる、向きの見え方）
- Phase 3: 3D回転球とWebアプリ化（Vanilla JS + Three.js）
- Phase 4: 公開カタログ連携 / Phase 5: 画像入力（実装価値を要判断）
- 対象読者・投影法の既定値・用語表記の統一
