"""コマンドライン: python -m beachball_decoder --preset thrust -o out.png"""

import argparse
import sys

from .fault import from_mt_use, from_sdr
from .render import render_decoded

# 代表的な断層（走向, 傾斜, すべり角）
PRESETS = {
    "thrust": (30, 45, 90),
    "normal": (30, 60, -90),
    "strike_left": (45, 90, 0),
    "strike_right": (45, 90, 180),
    "oblique": (30, 60, 45),
}


def build_parser():
    p = argparse.ArgumentParser(prog="beachball_decoder", description="震源球を直感的な図に変換する")
    p.add_argument("--strike", type=float, help="走向（度）")
    p.add_argument("--dip", type=float, help="傾斜（度, 0〜90）")
    p.add_argument("--rake", type=float, help="すべり角（度）")
    p.add_argument("--mt", type=float, nargs=6, metavar=("Mrr", "Mtt", "Mpp", "Mrt", "Mrp", "Mtp"),
                   help="モーメントテンソル（GCMT/USGS形式: r=上, t=南, p=東）")
    p.add_argument("--preset", choices=sorted(PRESETS), help="代表的な断層の例")
    p.add_argument("-o", "--output", default="decoded.png", help="出力画像のパス（既定: decoded.png）")
    p.add_argument("--dpi", type=int, default=150)
    p.add_argument("--title", help="図の題名")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    given = [args.strike is not None or args.dip is not None or args.rake is not None, args.mt is not None,
             args.preset is not None]
    if sum(given) != 1:
        print("エラー: 入力は「--strike/--dip/--rake」「--mt」「--preset」のいずれか1つだけ指定してください",
              file=sys.stderr)
        return 2
    try:
        if args.preset:
            mech = from_sdr(*PRESETS[args.preset])
        elif args.mt:
            mech = from_mt_use(*args.mt)
        else:
            if None in (args.strike, args.dip, args.rake):
                print("エラー: --strike, --dip, --rake はすべて指定してください", file=sys.stderr)
                return 2
            mech = from_sdr(args.strike, args.dip, args.rake)
    except ValueError as e:
        print(f"エラー: {e}", file=sys.stderr)
        return 2
    render_decoded(mech, args.output, dpi=args.dpi, title=args.title)
    print(f"{args.output} を出力しました（{mech.fault_type[0]}）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
