"""Python 実装の計算結果を JSON に書き出し、JavaScript 版との照合に使う。

使い方: .venv/bin/python tools/make_golden.py
"""

import json
from pathlib import Path

import numpy as np

from beachball_decoder import fault, render

CASES = [(0, 45, 90), (30, 60, -90), (45, 90, 0), (45, 90, 180), (200, 80, 180), (123, 35, 40),
         (310, 70, -140), (75, 20, 110), (250, 55, -25)]
MTS = [(1.7, -0.3, -1.4, 0.5, -0.2, 0.9), (-0.5, 0.2, 0.3, -1.1, 0.4, 0.6)]


def mech_dict(m):
    return {"planeA": list(m.plane_a), "planeB": list(m.plane_b), "moment": m.moment.tolist(),
            "pAxis": list(m.p_axis), "tAxis": list(m.t_axis), "faultType": m.fault_type[0],
            "faultTypeKey": m.fault_type[1]}


def main():
    out = {"sdr": [], "mt": []}
    rng = np.random.default_rng(0)
    for sdr in CASES:
        m = fault.from_sdr(*sdr)
        samples = []
        for _ in range(12):
            az, tk = rng.uniform(0, 2 * np.pi), rng.uniform(0, np.pi)
            samples.append([float(az), float(tk), float(render._pressure(m.moment, az, tk))])
        out["sdr"].append({"input": list(sdr), "mech": mech_dict(m), "pressure": samples})
    for mt in MTS:
        out["mt"].append({"input": list(mt), "mech": mech_dict(fault.from_mt_use(*mt))})
    path = Path(__file__).resolve().parent.parent / "web" / "test" / "golden.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{path} を出力しました")


if __name__ == "__main__":
    main()
