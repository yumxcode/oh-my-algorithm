"""
Test 04: Stability Analysis
Computes CoM drift, tilt statistics, perturbation recovery metrics.

Usage: python analyze.py [--results results.json] [--out report.md]
"""
import json
import argparse
import numpy as np
from pathlib import Path


def main(results_path: str, out_path: str):
    with open(results_path) as f:
        r = json.load(f)

    static   = r["static_records"]
    trials   = r["perturbation_trials"]
    fall_thr = r.get("fall_tilt_deg", 30.0)

    # ── Static analysis ────────────────────────────────────────────────────
    rolls   = [s.get("roll_deg", 0)  for s in static]
    pitches = [s.get("pitch_deg", 0) for s in static]
    heights = [s.get("height_m", 0)  for s in static]

    roll_std  = float(np.std(rolls))
    pitch_std = float(np.std(pitches))
    h_drift   = float(np.max(heights) - np.min(heights)) if heights else 0.0
    max_tilt  = float(max(np.max(np.abs(rolls)), np.max(np.abs(pitches))))

    # ── Perturbation analysis ──────────────────────────────────────────────
    n_trials   = len(trials)
    n_falls    = sum(1 for t in trials if t["fell"])
    n_survived = n_trials - n_falls

    recovery_times = []
    for trial in trials:
        if trial["fell"]:
            continue
        traj = trial["trajectory"]
        if not traj:
            continue
        # Recovery = first time tilt < 5 deg and stays there
        for i, pt in enumerate(traj):
            tilt = max(abs(pt.get("roll_deg", 0)), abs(pt.get("pitch_deg", 0)))
            if tilt < 5.0:
                recovery_times.append(pt["t"])
                break

    rec_mean = float(np.mean(recovery_times)) if recovery_times else None
    rec_max  = float(np.max(recovery_times))  if recovery_times else None

    feedback = []

    # ── Report ─────────────────────────────────────────────────────────────
    lines = [
        "# Test 04 — Stability Analysis Report",
        "",
        f"**Static duration**: {r['static_duration_s']}s  |  "
        f"**Perturbation force**: {r['perturb_force_n']}N  |  "
        f"**Fall threshold**: {fall_thr}°",
        "",
        "## Static Standing",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Roll std      | {roll_std:.3f}° |",
        f"| Pitch std     | {pitch_std:.3f}° |",
        f"| Max tilt      | {max_tilt:.3f}° |",
        f"| Height drift  | {h_drift*100:.2f} cm |",
        "",
    ]

    if roll_std > 3.0 or pitch_std > 3.0:
        feedback.append(
            f"- **FB-S1**: High static tilt variance (roll_std={roll_std:.2f}°, "
            f"pitch_std={pitch_std:.2f}°). Hypothesis: insufficient balance reward "
            f"in training. Recommendation: increase tilt penalty weight in $design reward function."
        )
    if h_drift > 0.05:
        feedback.append(
            f"- **FB-S2**: Height drift {h_drift*100:.1f}cm during static stand. "
            f"May indicate leg compliance mismatch. Review sim body height target."
        )

    lines += [
        "## Perturbation Trials",
        "",
        f"| Trials | Survived | Falls | Survival Rate |",
        f"|--------|----------|-------|---------------|",
        f"| {n_trials} | {n_survived} | {n_falls} | "
        f"{'N/A' if not n_trials else f'{n_survived/n_trials*100:.0f}%'} |",
        "",
    ]

    if recovery_times:
        lines += [
            f"| Recovery time mean | {rec_mean:.3f}s |",
            f"| Recovery time max  | {rec_max:.3f}s  |",
            "",
        ]
        if rec_mean and rec_mean > 1.5:
            feedback.append(
                f"- **FB-S3**: Mean recovery time {rec_mean:.2f}s is slow. "
                f"Consider increasing recovery reward shaping in $design or "
                f"training with higher-amplitude perturbations."
            )

    if n_falls > 0:
        fall_rate = n_falls / n_trials if n_trials else 0
        feedback.append(
            f"- **FB-S4**: {n_falls}/{n_trials} perturbation trials resulted in falls "
            f"({fall_rate*100:.0f}% fall rate). "
            f"Force = {r['perturb_force_n']}N. "
            f"Recommendation: (a) add push recovery training in sim, "
            f"(b) reduce perturbation force to find stability boundary."
        )

    lines += ["## Design Feedback", ""]
    if feedback:
        lines += feedback
    else:
        lines.append("- Stability within acceptable bounds. No design changes required.")

    lines += [
        "",
        "## Per-Trial Summary",
        "",
        "| # | Direction | Fell? | Max Tilt (°) | Recovery (s) |",
        "|---|-----------|-------|-------------|--------------|",
    ]
    for i, trial in enumerate(trials):
        traj = trial["trajectory"]
        max_t = max(
            (max(abs(pt.get("roll_deg", 0)), abs(pt.get("pitch_deg", 0))) for pt in traj),
            default=0.0
        )
        rec = recovery_times[i] if i < len(recovery_times) else "—"
        rec_str = f"{rec:.3f}" if isinstance(rec, float) else rec
        lines.append(
            f"| {i+1} | {trial['direction']} | {'✗ FALL' if trial['fell'] else '✓'} | "
            f"{max_t:.2f} | {rec_str} |"
        )

    lines += [
        "",
        "_Generated by analyze.py — Test 04 Stability_",
    ]

    Path(out_path).write_text("\n".join(lines))
    print(f"Report written → {out_path}")
    print(f"Falls: {n_falls}/{n_trials}  |  Static max tilt: {max_tilt:.2f}°")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results.json")
    ap.add_argument("--out",     default="report.md")
    args = ap.parse_args()
    main(args.results, args.out)
