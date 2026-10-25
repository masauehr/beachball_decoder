"""fault.py の数式を検証する（obspy・教科書の事実との照合）。"""

import numpy as np
import pytest
from obspy.imaging.beachball import aux_plane as obspy_aux_plane

from beachball_decoder import fault

CASES = [(0, 45, 90), (30, 60, -90), (90, 90, 0), (200, 80, 180), (123, 35, 40), (310, 70, -140)]


def _angle_diff(a, b):
    return abs((a - b + 180.0) % 360.0 - 180.0)


@pytest.mark.parametrize("sdr", CASES)
def test_補助面はobspyと一致(sdr):
    mine = fault.aux_plane(*sdr)
    ref = obspy_aux_plane(*sdr)
    assert _angle_diff(mine[0], ref[0]) < 1e-6
    assert mine[1] == pytest.approx(ref[1], abs=1e-6)
    assert _angle_diff(mine[2], ref[2]) < 1e-6


@pytest.mark.parametrize("sdr", CASES)
def test_補助面の補助面は元に戻る(sdr):
    back = fault.aux_plane(*fault.aux_plane(*sdr))
    assert _angle_diff(back[0], sdr[0]) < 1e-6
    assert back[1] == pytest.approx(sdr[1], abs=1e-6)
    assert _angle_diff(back[2], sdr[2]) < 1e-6


@pytest.mark.parametrize("sdr", CASES)
def test_両節面から同じテンソルになる(sdr):
    m1 = fault.moment_tensor(*sdr)
    m2 = fault.moment_tensor(*fault.aux_plane(*sdr))
    assert np.allclose(m1, m2, atol=1e-9)


@pytest.mark.parametrize("sdr", CASES)
def test_テンソルから節面を復元できる(sdr):
    # 垂直断層やrake=±180は表現が複数あるため、復元した両節面が元と同じテンソルになることで確認する
    m = fault.moment_tensor(*sdr)
    mech = fault.from_mt_use(*fault.ned_to_use(m))
    assert np.allclose(fault.moment_tensor(*mech.plane_a), m, atol=1e-9)
    assert np.allclose(fault.moment_tensor(*mech.plane_b), m, atol=1e-9)


def test_逆断層は圧縮軸が水平_引張軸が鉛直():
    mech = fault.from_sdr(0, 45, 90)
    assert mech.t_axis[1] == pytest.approx(90.0, abs=1e-6)
    assert mech.p_axis[1] == pytest.approx(0.0, abs=1e-6)


def test_正断層は圧縮軸が鉛直_引張軸が水平():
    mech = fault.from_sdr(0, 45, -90)
    assert mech.p_axis[1] == pytest.approx(90.0, abs=1e-6)
    assert mech.t_axis[1] == pytest.approx(0.0, abs=1e-6)


def test_GCMT形式の逆断層はMrrが正():
    # 逆断層では Mrr > 0（鉛直方向が「押し」）。教科書・GCMT の符号規約と一致する
    m = fault.moment_tensor(0, 45, 90)
    assert fault.ned_to_use(m)[0] > 0
    m = fault.moment_tensor(0, 45, -90)
    assert fault.ned_to_use(m)[0] < 0


def test_USE変換は往復で元に戻る():
    use = (1.7, -0.3, -1.4, 0.5, -0.2, 0.9)
    assert np.allclose(fault.ned_to_use(fault.use_to_ned(*use)), use)


@pytest.mark.parametrize(
    "rake,key",
    [(90, "thrust"), (-90, "normal"), (0, "strike_left"), (180, "strike_right"), (-180, "strike_right"),
     (45, "oblique_thrust"), (-135, "oblique_normal")],
)
def test_断層タイプ判定(rake, key):
    assert fault.classify(rake)[1] == key


def test_傾斜の範囲外は拒否():
    with pytest.raises(ValueError):
        fault.from_sdr(0, 120, 0)
