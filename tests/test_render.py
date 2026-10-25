"""描画・CLI のテスト。震源球の黒白は obspy の描画と画素単位で照合する。"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pytest
from obspy.imaging.beachball import beach

from beachball_decoder import cli, fault, render


def _my_sign(mech, x, y):
    rho = np.hypot(x, y)
    az = np.arctan2(x, y)
    takeoff = 2.0 * np.arcsin(rho / np.sqrt(2.0))
    return render._pressure(mech.moment, az, takeoff)


@pytest.mark.parametrize("sdr", [(0, 45, 90), (30, 60, -90), (45, 90, 0), (123, 35, 40)])
def test_黒白がobspyの震源球と一致する(sdr):
    mech = fault.from_sdr(*sdr)
    fig = plt.figure(figsize=(4, 4), dpi=100)
    ax = fig.add_axes([0, 0, 1, 1])
    # 走向・傾斜・すべり角の経路は近似楕円のため、厳密な等面積投影のテンソル経路で照合する
    ax.add_collection(beach(list(fault.ned_to_use(mech.moment)), xy=(0, 0), width=200, facecolor="k", bgcolor="w", linewidth=0))
    ax.set_xlim(-110, 110)
    ax.set_ylim(-110, 110)
    ax.axis("off")
    fig.canvas.draw()
    img = np.asarray(fig.canvas.buffer_rgba())[..., 0]
    plt.close(fig)
    h, w = img.shape
    checked = 0
    for x in np.linspace(-0.9, 0.9, 19):
        for y in np.linspace(-0.9, 0.9, 19):
            if np.hypot(x, y) > 0.9:
                continue
            v = _my_sign(mech, x, y)
            if abs(v) < 0.25:  # 節面の近くは多角形近似・画素の誤差があるので除く
                continue
            col = int((x * 100 + 110) / 220 * w)
            row = int((110 - y * 100) / 220 * h)
            dark = img[row, col] < 128
            assert dark == (v > 0), (sdr, x, y)
            checked += 1
    assert checked > 100


def test_逆断層は中心が黒_正断層は中心が白():
    center = lambda sdr: _my_sign(fault.from_sdr(*sdr), 0.0, 0.0)
    assert center((0, 45, 90)) > 0
    assert center((0, 45, -90)) < 0


def test_ブロックは断層面で上盤と下盤に分かれる():
    hw, fw, cut, n, d = render._block_polys(30, 45, 90)
    assert np.dot(n, d) == pytest.approx(0.0, abs=1e-9)
    assert all(np.dot(n, p) >= -1e-9 for poly in hw for p in poly)
    assert all(np.dot(n, p) <= 1e-9 for poly in fw for p in poly)
    assert all(abs(np.dot(n, p)) < 1e-9 for p in cut)
    # 逆断層では上盤が上へ動く（すべり方向の上向き成分が正）
    assert d[2] > 0


def test_CLIで画像が出力される(tmp_path):
    out = tmp_path / "x.png"
    assert cli.main(["--preset", "thrust", "-o", str(out), "--dpi", "40"]) == 0
    assert out.stat().st_size > 5000


def test_CLIは入力が不正ならエラー(capsys):
    assert cli.main(["--strike", "10"]) == 2
    assert cli.main(["--strike", "10", "--dip", "120", "--rake", "0"]) == 2
    assert cli.main([]) == 2


def test_モーメントテンソル入力で出力できる(tmp_path):
    out = tmp_path / "mt.png"
    assert cli.main(["--mt", "1.7", "-0.3", "-1.4", "0.5", "-0.2", "0.9", "-o", str(out), "--dpi", "40"]) == 0


@pytest.mark.parametrize("inside", [True, False])
@pytest.mark.parametrize("sdr", [(30, 45, 90), (45, 90, 0)])
def test_下半球の立体図が描ける(sdr, inside):
    fig = plt.figure(figsize=(4, 4))
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    render.draw_hemisphere(ax, fault.from_sdr(*sdr), elev=35.0, inside=inside)
    fig.canvas.draw()
    plt.close(fig)


def test_立体図は見えている側の面だけを描く():
    # お椀の内側をのぞくとき、見える面は下半球のおよそ半分以下になる
    fig = plt.figure(figsize=(4, 4))
    ax = fig.add_subplot(1, 1, 1, projection="3d")
    render.draw_hemisphere(ax, fault.from_sdr(30, 45, 90), elev=38.0, inside=True)
    coll = ax.collections[0]
    plt.close(fig)
    assert 0 < len(coll.get_facecolor()) < 144 * 45
