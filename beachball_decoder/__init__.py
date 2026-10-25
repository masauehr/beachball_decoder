"""震源球（ビーチボール図）を直感的な図へ変換するパッケージ。"""

from .fault import Mechanism, from_mt_use, from_sdr

__all__ = ["Mechanism", "from_sdr", "from_mt_use"]
