"""震源球・断層ブロック図・地表の初動マップ・解説文をまとめた図を描く。"""

import matplotlib
import matplotlib.colors

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib import colors as _colors  # noqa: F401
from matplotlib import font_manager
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

from .fault import Mechanism, _sdr_to_nd

COMPRESSION = "#222222"  # 押し（黒）
DILATATION = "#ffffff"  # 引き（白）
UP_COLOR = "#e8a3a3"  # 地表で上向きの初動
DOWN_COLOR = "#a3c0e8"  # 地表で下向きの初動
HW_COLOR = "#f4b183"  # 上盤
FW_COLOR = "#9dc3e6"  # 下盤

_FONTS = ("Hiragino Sans", "Hiragino Kaku Gothic ProN", "YuGothic", "BIZ UDGothic", "Noto Sans CJK JP", "IPAexGothic")


def setup_font():
    """利用可能な日本語フォントを探して設定する。"""
    names = {f.name for f in font_manager.fontManager.ttflist}
    for name in _FONTS:
        if name in names:
            plt.rcParams["font.family"] = name
            break
    plt.rcParams["axes.unicode_minus"] = False


def _pressure(m, az, takeoff):
    """方位 az・離陸角 takeoff（下向き鉛直から）の射線の P波初動の符号付き振幅（正=押し）。"""
    g = np.stack([np.sin(takeoff) * np.cos(az), np.sin(takeoff) * np.sin(az), np.cos(takeoff)], axis=-1)
    return np.einsum("...i,ij,...j->...", g, m, g)


def _project(trend, plunge):
    """下半球・等面積投影での (x=東, y=北)。半径は外周が 1。"""
    takeoff = np.radians(90.0 - plunge)
    rho = np.sqrt(2.0) * np.sin(takeoff / 2.0)
    az = np.radians(trend)
    return rho * np.sin(az), rho * np.cos(az)


def _plane_midpoint(strike, dip):
    """節面の弧の中点（傾斜方向の射線）の投影座標。"""
    return _project((strike + 90.0) % 360.0, 90.0 - dip)


def draw_beachball(ax, mech: Mechanism):
    """下半球・等面積投影の震源球。黒=押し, 白=引き。P軸・T軸と2つの節面を記す。"""
    n = 600
    xs = np.linspace(-1, 1, n)
    x, y = np.meshgrid(xs, xs)
    rho = np.hypot(x, y)
    az = np.arctan2(x, y)
    takeoff = 2.0 * np.arcsin(np.clip(rho, 0, 1) / np.sqrt(2.0))
    val = np.ma.masked_where(rho > 1.0, _pressure(mech.moment, az, takeoff))
    ax.contourf(x, y, val, levels=[-1e9, 0, 1e9], colors=[DILATATION, COMPRESSION])
    ax.contour(x, y, val, levels=[0], colors="#c0392b", linewidths=2)
    ax.add_patch(plt.Circle((0, 0), 1, fill=False, ec="k", lw=2))
    for label, (strike, dip, _) in (("A", mech.plane_a), ("B", mech.plane_b)):
        px, py = _plane_midpoint(strike, dip)
        ax.text(px * 1.0, py * 1.0, label, color="#c0392b", ha="center", va="center", fontsize=13,
                fontweight="bold", bbox=dict(boxstyle="circle,pad=0.15", fc="white", ec="#c0392b"))
    for name, axis, fc in (("P", mech.p_axis, "white"), ("T", mech.t_axis, "#222222")):
        px, py = _project(*axis)
        ax.plot(px, py, "o", ms=17, mfc=fc, mec="#2e86c1", mew=2.5)
        ax.text(px, py, name, ha="center", va="center", fontsize=10, fontweight="bold",
                color="#2e86c1")
    ax.text(0, 1.07, "N", ha="center", va="bottom", fontsize=12, fontweight="bold")
    ax.annotate("", xy=(0, 1.05), xytext=(0, 1.0), arrowprops=dict(arrowstyle="-|>", color="k"))
    ax.set_xlim(-1.18, 1.18)
    ax.set_ylim(-1.12, 1.25)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("震源球（真下の半球を真上から見た図）", fontsize=12)


# ---- 断層ブロック図 -------------------------------------------------------

def _clip(poly, normal, offset):
    """多角形を半空間 normal·p >= offset で切り取る（Sutherland–Hodgman）。"""
    out = []
    for i, cur in enumerate(poly):
        prev = poly[i - 1]
        dc = np.dot(normal, cur) - offset
        dp = np.dot(normal, prev) - offset
        if dc >= 0:
            if dp < 0:
                out.append(prev + (cur - prev) * (dp / (dp - dc)))
            out.append(cur)
        elif dp >= 0:
            out.append(prev + (cur - prev) * (dp / (dp - dc)))
    return out


def _ned_to_enu(v):
    return np.array([v[1], v[0], -v[2]], dtype=float)


def _box_faces(hx, hy, hz):
    def quad(*pts):
        return [np.array(p, dtype=float) for p in pts]

    return [
        quad((-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz)),  # 上面
        quad((-hx, -hy, -hz), (-hx, hy, -hz), (hx, hy, -hz), (hx, -hy, -hz)),  # 底面
        quad((-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz)),  # 南面
        quad((-hx, hy, -hz), (-hx, hy, hz), (hx, hy, hz), (hx, hy, -hz)),  # 北面
        quad((-hx, -hy, -hz), (-hx, -hy, hz), (-hx, hy, hz), (-hx, hy, -hz)),  # 西面
        quad((hx, -hy, -hz), (hx, hy, -hz), (hx, hy, hz), (hx, -hy, hz)),  # 東面
    ]


BOX = (1.2, 1.2, 0.8)


def _block_polys(strike, dip, rake, box=BOX):
    """上盤・下盤それぞれの多面体の面リスト、断層面の多角形、法線(ENU)、すべり(ENU)を返す。"""
    n_ned, d_ned = _sdr_to_nd(strike, dip, rake)
    n, d = _ned_to_enu(n_ned), _ned_to_enu(d_ned)
    hw, fw = [], []
    for f in _box_faces(*box):
        a = _clip(f, n, 0.0)
        b = _clip(f, -n, 0.0)
        if len(a) >= 3:
            hw.append(a)
        if len(b) >= 3:
            fw.append(b)
    # 断層面: 面内の2方向で十分大きい正方形を作り、箱で切り取る
    u = np.cross(n, [0, 0, 1.0])
    if np.linalg.norm(u) < 1e-9:
        u = np.array([1.0, 0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    big = 6.0
    plane = [u * big + v * big, -u * big + v * big, -u * big - v * big, u * big - v * big]
    for axis in range(3):
        for sign in (1.0, -1.0):
            e = np.zeros(3)
            e[axis] = -sign
            plane = _clip(plane, e, -box[axis])
    return hw, fw, plane, n, d


def _shade(poly, base, light=np.array([0.35, -0.45, 0.82])):
    """面の向きに応じて色を明暗づける。"""
    p = np.array(poly)
    nrm = np.cross(p[1] - p[0], p[2] - p[0])
    norm = np.linalg.norm(nrm)
    k = 0.75 if norm < 1e-12 else 0.68 + 0.32 * abs(np.dot(nrm / norm, light / np.linalg.norm(light)))
    c = np.array(matplotlib.colors.to_rgb(base)) * min(k, 1.0)
    return (*c, 0.97)


def draw_block(ax, plane_params, title):
    """断層で切った2つの岩盤ブロックと、上盤・下盤の動きを矢印で示す3D図。"""
    strike, dip, rake = plane_params
    hw, fw, cut, n, d = _block_polys(strike, dip, rake)
    shift = 0.3
    polys, colors = [], []
    for poly in fw + [cut]:
        polys.append(np.array([p - d * shift for p in poly]))
        colors.append(_shade(poly, FW_COLOR))
    for poly in hw + [cut]:
        polys.append(np.array([p + d * shift for p in poly]))
        colors.append(_shade(poly, HW_COLOR))
    ax.computed_zorder = False
    coll = Poly3DCollection(polys, facecolors=colors, edgecolors="#333333", linewidths=0.9, zorder=1)
    ax.add_collection3d(coll)
    # 動きの矢印は、見えるように各ブロックの上面（または断層面）の上に重ねて描く
    cen = np.mean(np.array(cut), axis=0)
    top = np.array([0.0, 0.0, BOX[2]])
    for sign, color in ((1.0, "#b03a00"), (-1.0, "#1f4e79")):
        # 各ブロックの上面の、断層から少し離れた点を始点にする
        side = n * sign
        start = cen + side * 0.55 + d * shift * sign
        start = np.array([start[0], start[1], min(start[2], BOX[2]) + 0.02])
        ax.quiver(*start, *(sign * d * 1.0), color=color, linewidth=4, arrow_length_ratio=0.3, zorder=10)
    ax.quiver(1.15, 1.35, 0.9, 0, 0.55, 0, color="k", linewidth=2, arrow_length_ratio=0.35, zorder=10)
    ax.text(1.15, 2.05, 0.9, "N", fontsize=12, fontweight="bold", ha="center", zorder=10)
    for sign, label, color in ((1.0, "上盤", "#b03a00"), (-1.0, "下盤", "#1f4e79")):
        pos = cen + n * sign * 1.45 + d * shift * sign * 2
        pos = np.array([pos[0], pos[1], np.clip(pos[2], -BOX[2], BOX[2] + 0.6) + 0.35])
        ax.text(*pos, label, color=color, ha="center", fontsize=12, fontweight="bold", zorder=10)
    lim = 1.45
    ax.set_xlim(-lim, lim)
    ax.set_ylim(-lim, lim)
    ax.set_zlim(-lim * 0.8, lim * 0.8)
    ax.set_box_aspect((1, 1, 0.8))
    ax.view_init(elev=26, azim=float(np.degrees(np.arctan2(n[1], n[0]))) - 30)
    ax.set_axis_off()
    ax.set_title(title, fontsize=12)


# ---- 地表の初動マップ -----------------------------------------------------

def draw_surface_map(ax, mech: Mechanism, depth_km=10.0, half_km=30.0):
    """震源の真上付近の地表で、P波の初動が上向き（押し）か下向き（引き）かを色で示す地図。"""
    n = 500
    xs = np.linspace(-half_km, half_km, n)
    x, y = np.meshgrid(xs, xs)
    horiz = np.hypot(x, y)
    az = np.arctan2(x, y)
    theta = np.arctan2(horiz, depth_km)  # 鉛直からの角度（上向きの射線）
    val = _pressure_up(mech.moment, az, theta)  # 正=地面が上向きに動く（押し）
    ax.contourf(x, y, val, levels=[-1e9, 0, 1e9], colors=[DOWN_COLOR, UP_COLOR])
        # 断層の地表トレース（走向方向の直線）
    for (strike, dip, _), style, label in ((mech.plane_a, "-", "A"), (mech.plane_b, "--", "B")):
        s = np.radians(strike)
        dx, dy = np.sin(s), np.cos(s)
        L = half_km * 1.4
        ax.plot([-L * dx, L * dx], [-L * dy, L * dy], style, color="#c0392b", lw=2)
        tx, ty = 0.82 * half_km * dx, 0.82 * half_km * dy
        ax.text(tx, ty, label, color="#c0392b", fontsize=12, fontweight="bold", ha="center", va="center",
                bbox=dict(boxstyle="circle,pad=0.15", fc="white", ec="#c0392b"))
    ax.plot(0, 0, "*", ms=18, mfc="yellow", mec="k")
    # 矢印記号で地面の動きを示す
    for r in (14.0, 24.0):
        for k in range(8):
            a = np.radians(45 * k + (22.5 if r > 20 else 0))
            px, py = r * np.sin(a), r * np.cos(a)
            up = _pressure_up(mech.moment, np.array(a), np.arctan2(r, depth_km)) > 0
            ax.text(px, py, "↑" if up else "↓", ha="center", va="center", fontsize=15, fontweight="bold",
                    color="#8b1a1a" if up else "#1f4e79")
    ax.set_xlim(-half_km, half_km)
    ax.set_ylim(-half_km, half_km)
    ax.set_aspect("equal")
    ax.set_xticks([])
    ax.set_yticks([])
    ax.text(-half_km * 0.93, half_km * 0.93, "N ↑", ha="left", va="top", fontsize=12, fontweight="bold",
            bbox=dict(fc="white", ec="none", alpha=0.8))
    ax.set_title("地表の初動マップ（震源の真上から）", fontsize=12)


def _pressure_up(m, az, theta):
    """上向きの射線（鉛直上から角度 theta）の符号付き振幅。γ→-γ でも二次形式は不変なので下向きと同じ式。"""
    return _pressure(m, az, theta)


# ---- 解説文 ---------------------------------------------------------------

_EXPLAIN = {
    "thrust": "逆断層: 上盤が下盤に乗り上げる動き。水平方向に押し縮められている場所で起こる（プレート境界の沈み込み帯など）。",
    "normal": "正断層: 上盤が下盤に対してずり落ちる動き。水平方向に引き伸ばされている場所で起こる。",
    "strike_left": "左横ずれ断層: 断層を挟んで向こう側が左へずれる。ほぼ水平方向にずれ、上下の動きは小さい。",
    "strike_right": "右横ずれ断層: 断層を挟んで向こう側が右へずれる。ほぼ水平方向にずれ、上下の動きは小さい。",
    "oblique_thrust": "斜めずれ: 乗り上げる動きに横ずれが加わっている。",
    "oblique_normal": "斜めずれ: ずり落ちる動きに横ずれが加わっている。",
}


def _axis_text(name, axis):
    trend, plunge = axis
    if plunge < 15:
        tilt = "ほぼ水平"
    elif plunge > 75:
        return f"{name}軸: ほぼ鉛直"
    else:
        tilt = f"水平から {plunge:.0f}° 傾く"
    return f"{name}軸: 方位 {trend:.0f}°、{tilt}"


def build_summary(mech: Mechanism):
    """日本語の解説文（複数行）を返す。"""
    name, key = mech.fault_type
    sa, da, ra = mech.plane_a
    sb, db, rb = mech.plane_b
    lines = [
        f"この地震の断層タイプ: {name}",
        _EXPLAIN[key],
        "",
        f"節面A  走向 {sa:.0f}° / 傾斜 {da:.0f}° / すべり角 {ra:.0f}°   （{mech.fault_type[0]}）",
        f"節面B  走向 {sb:.0f}° / 傾斜 {db:.0f}° / すべり角 {rb:.0f}°   （{mech.fault_type_b[0]}）",
        _axis_text("P", mech.p_axis) + "（圧縮される向き）",
        _axis_text("T", mech.t_axis) + "（引き伸ばされる向き）",
        "",
        "読み方",
        "・黒＝初動が「押し」（震源から遠ざかる向きに地面が動く）、白＝「引き」。",
        "・黒い領域の中心付近に T軸、白い領域の中心付近に P軸がある（名前と逆で紛らわしい）。",
        "・赤線は2本の節面。実際の断層面は A か B の一方で、地震波の初動だけでは決められない。",
        "  （余震の並び・地表の断層・津波・地殻変動などと突き合わせて判断する）",
    ]
    return lines


def render_decoded(mech: Mechanism, path, dpi=150, title=None):
    """震源球と、それを直感的に読み解くための図をまとめて1枚の画像に書き出す。"""
    setup_font()
    fig = plt.figure(figsize=(18, 10.5), facecolor="white")
    gs = fig.add_gridspec(2, 3, height_ratios=[1.15, 1], hspace=0.08, wspace=0.05, left=0.02, right=0.98,
                          top=0.9, bottom=0.03)
    ax_ball = fig.add_subplot(gs[0, 0])
    draw_beachball(ax_ball, mech)
    ax_a = fig.add_subplot(gs[0, 1], projection="3d")
    draw_block(ax_a, mech.plane_a, f"節面Aが断層面なら（{mech.fault_type[0]}）\n橙=上盤の動き / 青=下盤の動き")
    ax_b = fig.add_subplot(gs[0, 2], projection="3d")
    draw_block(ax_b, mech.plane_b, f"節面Bが断層面なら（{mech.fault_type_b[0]}）\n橙=上盤の動き / 青=下盤の動き")
    ax_map = fig.add_subplot(gs[1, 0])
    draw_surface_map(ax_map, mech)
    ax_txt = fig.add_subplot(gs[1, 1:])
    ax_txt.axis("off")
    lines = build_summary(mech)
    y = 0.98
    for i, line in enumerate(lines):
        bold = i == 0 or line == "読み方"
        ax_txt.text(0.0, y, line, fontsize=15 if i == 0 else 11.5, fontweight="bold" if bold else "normal",
                    va="top", transform=ax_txt.transAxes)
        y -= 0.115 if i == 0 else 0.075
    fig.suptitle(title or "震源球デコーダー  ―  ビーチボールを断層の動きに読み解く", fontsize=18, fontweight="bold")
    fig.savefig(path, dpi=dpi)
    plt.close(fig)
    return path
