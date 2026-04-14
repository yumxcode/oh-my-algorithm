"""
Test 08: Terrain Traversal Analysis
Success rate per terrain type, speed degradation, tilt excursions, design feedback.

Usage: python analyze.py [--results results.json] [--out report.md]
"""
import json
import argparse
import numpy as np
from pathlib import Path


def main(results_path: str, out_path: str):
    with open(results_path) as f:
        r = json.load(f)

    runs      = r["runs"]          # list of runs, each is list of segment results
    n_runs    = r["n_traversals"]
    walk_v    = r["walk_speed_mps"]
    segments  = [s["name"] for s in r["terrain_segments"]]
    feedback  = []

    # Aggregate per segment across runs
    seg_stats = {}
    for seg_name in segments:
        seg_results = []
        for run in runs:
            for s in run:
                if s["segment"] == seg_name:
                    seg_results.append(s)
        if not seg_results:
            continue

        n_total   = len(seg_results)
        n_falls   = sum(1 for s in seg_results if s["fell"])
        survived  = [s for s in seg_results if not s["fell"]]
        mean_spd  = float(np.mean([s["mean_speed_mps"] for s in survived])) if survived else 0.0
        max_tilt  = float(np.max([s["max_tilt_deg"]    for s in seg_results]))
        mean_tilt = float(np.mean([s["mean_tilt_deg"]  for s in seg_results]))
        spd_ratio = mean_spd / walk_v if walk_v else 0.0

        seg_stats[seg_name] = {
            "n_total"   : n_total,
            "n_falls"   : n_falls,
            "fall_rate" : n_falls / n_total if n_total else 0.0,
            "mean_speed": mean_spd,
            "spd_ratio" : spd_ratio,
            "max_tilt"  : max_tilt,
            "mean_tilt" : mean_tilt,
        }

    lines = [
        "# Test 08 — Terrain Traversal Analysis Report",
        "",
        f"**Runs**: {n_runs}  |  **Target speed**: {walk_v} m/s",
        "",
        "## Per-Segment Performance",
        "",
        "| Segment | Falls | Fall Rate | Speed (m/s) | Speed Ratio | "
        "Max Tilt (°) | Status |",
        "|---------|-------|-----------|------------|-------------|"
        "------------|--------|",
    ]

    for seg_name, st in seg_stats.items():
        fall_rate = st["fall_rate"]
        status    = "✗ FAIL" if fall_rate > 0.33 else ("⚠️" if fall_rate > 0 else "✓")
        lines.append(
            f"| {seg_name} | {st['n_falls']}/{st['n_total']} | "
            f"{fall_rate:.0%} | {st['mean_speed']:.2f} | "
            f"{st['spd_ratio']:.0%} | {st['max_tilt']:.1f} | {status} |"
        )

        # Generate feedback
        if fall_rate > 0.33:
            feedback.append(
                f"- **FB-T{len(feedback)+1} [{seg_name}]**: High fall rate "
                f"({fall_rate:.0%}). This terrain type is a critical gap. "
                f"Recommendation: add '{seg_name}' terrain to sim training curriculum "
                f"with height map domain randomization matching this profile."
            )
        elif fall_rate > 0:
            feedback.append(
                f"- **FB-T{len(feedback)+1} [{seg_name}]**: Occasional falls "
                f"({fall_rate:.0%}). Recommend increasing training exposure to "
                f"this terrain type and adding tilt recovery reward."
            )
        if st["spd_ratio"] < 0.6 and fall_rate == 0:
            feedback.append(
                f"- **FB-T{len(feedback)+1} [{seg_name}]**: Significant speed "
                f"degradation ({st['spd_ratio']:.0%} of target). Policy is "
                f"overly conservative. Consider terrain-adaptive speed curriculum."
            )
        if st["max_tilt"] > 25:
            feedback.append(
                f"- **FB-T{len(feedback)+1} [{seg_name}]**: Large tilt excursions "
                f"({st['max_tilt']:.1f}°). Policy footstep placement may be "
                f"suboptimal. Review step-height estimation in design."
            )

    # Overall summary
    all_falls  = sum(st["n_falls"]  for st in seg_stats.values())
    all_trials = sum(st["n_total"]  for st in seg_stats.values())
    overall_fr = all_falls / all_trials if all_trials else 0.0
    worst_seg  = max(seg_stats, key=lambda k: seg_stats[k]["fall_rate"]) if seg_stats else "—"

    lines += [
        "",
        "## Overall",
        "",
        f"| | Value |",
        f"|---|---|",
        f"| Total trials | {all_trials} |",
        f"| Total falls | {all_falls} ({overall_fr:.0%}) |",
        f"| Hardest segment | {worst_seg} |",
        "",
    ]

    lines += ["## Design Feedback", ""]
    if feedback:
        lines += feedback
    else:
        lines.append("- Terrain traversal performance within acceptable bounds.")

    lines += [
        "",
        "## Next Steps",
        "",
        "Priority terrain types to add to sim training (ranked by fall rate):",
    ]
    ranked = sorted(seg_stats.items(), key=lambda x: x[1]["fall_rate"], reverse=True)
    for i, (seg, st) in enumerate(ranked[:3]):
        if st["fall_rate"] > 0:
            lines.append(f"{i+1}. `{seg}` — {st['fall_rate']:.0%} fall rate")

    lines += [
        "",
        "_Generated by analyze.py — Test 08 Terrain_",
    ]

    Path(out_path).write_text("\n".join(lines))
    print(f"Report written → {out_path}")
    print(f"Overall fall rate: {overall_fr:.0%}  ({all_falls}/{all_trials})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results.json")
    ap.add_argument("--out",     default="report.md")
    args = ap.parse_args()
    main(args.results, args.out)
