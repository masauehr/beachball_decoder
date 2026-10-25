"""断層パラメータ・モーメントテンソル・節面・P/T軸の相互変換。

座標系は NED（x=北, y=東, z=下）で統一する。
- 走向 strike: 北から時計回り。断層面を走向方向に見て、右側が傾斜の下がる側（上盤側）
- 傾斜 dip: 水平面からの角度（0〜90）
- すべり角 rake: 走向方向から測った、下盤に対する上盤のずれ方向
  （90=逆断層, -90=正断層, 0=左横ずれ, ±180=右横ずれ）
- モーメントテンソル M = n d^T + d n^T （n: 上盤向きの断層面法線, d: 上盤のすべり方向）
  P波の初動は γ·M·γ > 0 のとき「押し」（震源から遠ざかる向き）
"""

from dataclasses import dataclass

import numpy as np


def _deg(rad):
    return float(np.degrees(rad))


def _sdr_to_nd(strike, dip, rake):
    """走向・傾斜・すべり角から、上盤向き法線 n とすべり方向 d（NED, 単位ベクトル）を返す。"""
    phi, delta, lam = np.radians([strike, dip, rake])
    s = np.array([np.cos(phi), np.sin(phi), 0.0])
    # 傾斜の下がる向き（走向の右側・下向き）
    dd = np.array([-np.sin(phi) * np.cos(delta), np.cos(phi) * np.cos(delta), np.sin(delta)])
    d = np.cos(lam) * s - np.sin(lam) * dd
    n = -np.cross(s, dd)
    return n, d


def _nd_to_sdr(n, d):
    """法線 n とすべり方向 d から (走向, 傾斜, すべり角) を返す。n は上向き成分を持つ側に正規化する。"""
    n = np.asarray(n, dtype=float)
    d = np.asarray(d, dtype=float)
    if n[2] > 1e-12:  # 下向きなら (n, d) を同時に反転（M は不変）
        n, d = -n, -d
    dip = np.arccos(np.clip(-n[2], -1.0, 1.0))
    phi = np.arctan2(-n[0], n[1])
    s = np.array([np.cos(phi), np.sin(phi), 0.0])
    dd = np.array([-np.sin(phi) * np.cos(dip), np.cos(phi) * np.cos(dip), np.sin(dip)])
    lam = np.arctan2(-np.dot(d, dd), np.dot(d, s))
    strike = _deg(phi) % 360.0
    rake = _deg(lam)
    if rake <= -180.0:
        rake += 360.0
    return strike, _deg(dip), rake


def moment_tensor(strike, dip, rake):
    """3x3 のモーメントテンソル（NED, M0=1 の規格化）。"""
    n, d = _sdr_to_nd(strike, dip, rake)
    return np.outer(n, d) + np.outer(d, n)


def aux_plane(strike, dip, rake):
    """補助面（もう一方の節面）の (走向, 傾斜, すべり角)。"""
    n, d = _sdr_to_nd(strike, dip, rake)
    return _nd_to_sdr(d, n)


def _axis_trend_plunge(v):
    """ベクトルを (方位角, 沈み込み角) に変換する。下向き（plunge>=0）に正規化。"""
    v = np.asarray(v, dtype=float)
    if v[2] < 0:
        v = -v
    trend = _deg(np.arctan2(v[1], v[0])) % 360.0
    plunge = _deg(np.arcsin(np.clip(v[2], -1.0, 1.0)))
    return trend, plunge


def classify(rake):
    """すべり角から断層タイプ名（日本語）と区分キーを返す。"""
    r = (rake + 180.0) % 360.0 - 180.0
    sin_r = np.sin(np.radians(r))
    cos_r = np.cos(np.radians(r))
    if abs(sin_r) >= np.sin(np.radians(67.5)):
        return ("逆断層", "thrust") if sin_r > 0 else ("正断層", "normal")
    lateral = "左横ずれ" if cos_r > 0 else "右横ずれ"
    if abs(sin_r) <= np.sin(np.radians(22.5)):
        return (f"{lateral}断層", "strike_left" if cos_r > 0 else "strike_right")
    base = "逆断層" if sin_r > 0 else "正断層"
    return (f"{lateral}成分を伴う{base}", "oblique_" + ("thrust" if sin_r > 0 else "normal"))


@dataclass
class Mechanism:
    """発震機構（二重couple）の情報一式。"""

    plane_a: tuple  # (走向, 傾斜, すべり角)
    plane_b: tuple
    moment: np.ndarray  # 3x3, NED
    p_axis: tuple  # (方位角, 沈み込み角)
    t_axis: tuple
    b_axis: tuple

    @property
    def fault_type(self):
        return classify(self.plane_a[2])

    @property
    def fault_type_b(self):
        return classify(self.plane_b[2])


def _axes_from_moment(m):
    # 固有値の昇順: 最小=P（圧縮軸）, 中間=B, 最大=T（引張軸）
    w, v = np.linalg.eigh(m)
    return (_axis_trend_plunge(v[:, 0]), _axis_trend_plunge(v[:, 1]), _axis_trend_plunge(v[:, 2]))


def from_sdr(strike, dip, rake):
    """走向・傾斜・すべり角から発震機構を作る。"""
    if not 0.0 <= dip <= 90.0:
        raise ValueError("傾斜は 0〜90 度で指定してください")
    rake = (float(rake) + 180.0) % 360.0 - 180.0
    if rake == -180.0:  # すべり角は (-180, 180] に統一
        rake = 180.0
    a = (float(strike) % 360.0, float(dip), rake)
    m = moment_tensor(*a)
    p, b, t = _axes_from_moment(m)
    return Mechanism(plane_a=a, plane_b=aux_plane(*a), moment=m, p_axis=p, t_axis=t, b_axis=b)


def use_to_ned(mrr, mtt, mpp, mrt, mrp, mtp):
    """GCMT/USGS 形式（r=上, t=南, p=東）のテンソル成分を NED の 3x3 に変換する。"""
    mnn, mee, mdd = mtt, mpp, mrr
    mnd, mde, mne = mrt, -mrp, -mtp
    return np.array([[mnn, mne, mnd], [mne, mee, mde], [mnd, mde, mdd]], dtype=float)


def ned_to_use(m):
    """NED の 3x3 を (Mrr, Mtt, Mpp, Mrt, Mrp, Mtp) に変換する。"""
    return (m[2, 2], m[0, 0], m[1, 1], m[0, 2], -m[1, 2], -m[0, 1])


def from_mt_use(mrr, mtt, mpp, mrt, mrp, mtp):
    """モーメントテンソル（USE 形式）から、最も近い二重couple成分の発震機構を作る。

    等方成分を除いた偏差テンソルの P軸・T軸から節面を求める（CLVD成分は無視する）。
    """
    m = use_to_ned(mrr, mtt, mpp, mrt, mrp, mtp)
    m = m - np.trace(m) / 3.0 * np.eye(3)
    w, v = np.linalg.eigh(m)
    p_vec, t_vec = v[:, 0], v[:, 2]
    n = (t_vec + p_vec) / np.sqrt(2.0)
    d = (t_vec - p_vec) / np.sqrt(2.0)
    a = _nd_to_sdr(n, d)
    b = _nd_to_sdr(d, n)
    mm = moment_tensor(*a)
    p, bb, t = _axes_from_moment(mm)
    return Mechanism(plane_a=a, plane_b=b, moment=mm, p_axis=p, t_axis=t, b_axis=bb)
