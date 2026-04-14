"""
Test 05: Gait Analysis
Computes step frequency, duty cycle, phase relationships, symmetry.
Compares to sim gait model.

Usage: python analyze.py [--results results.json] [--out report.md]
"""
import json
import argparse
import numpy as np
from pathlib import Path


def compute_contact_stats(records, foot_names):
    """Per-foot: duty cycle, step frequency, mean stance/swing duration."""
    stats = {}
    hz = 1.0 / (records[1]["t"] - records[0]["t"]) if len(records) > 1 else 50.0

    for foot in foot_names:
        contacts = [r["contacts"].get(foot, False) for r in records]
        arr      = np.array(contacts, dtype=float)

        # Duty cycle
        duty = float(arr.mean())

        # Find stance/swing transitions
        diff     = np.diff(arr)
        to_swing = np.where(diff < 0)[0]   # contact → air
        to_stance= np.where(diff > 0)[0]   # air → contact

        # Step frequency = number of full gait cycles / total time
        n_steps  = min(len(to_swing), len(to_stance))
        total_t  = records[-1]["t"] - records[0]["t"]
        step_freq= float(n_steps / total_t) if total_t > 0 else 0.0

        # Stance/swing durations (samples → seconds)
        stance_durs = []
        swing_durs  = []
        for i in range(min(len(to_swing), len(to_stance) - 1)):
            sw = to_swing[i]
            st = to_stance[i + 1] if i + 1 < len(to_stance) else None
            if st is not None and st > sw:
                swing_durs.append((st - sw) / hz)
            if i < len(to_stance):
                ns = to_swing[i + 1] if i + 1 < len(to_swing) else None
                if ns is not None and ns > to_stance[i]:
                    stance_durs.append((ns - to_stance[i]) / hz)

        stats[foot] = {
            "duty_cycle"        : duty,
            "step_freq_hz"      : step_freq,
            "n_steps"           : n_steps,
            "mean_stance_s"     : float(np.mean(stance_durs)) if stance_durs else None,
            "mean_swing_s"      : float(np.mean(swing_durs))  if swing_durs  else None,
            "std_stance_s"      : float(np.std(stance_durs))  if stance_durs else None,
        }
    return stats


def compute_velocity_stats(records):
    vx = [r["velocity"].get("vx_mps", 0) for r in records]
    vy = [r["velocity"].get("vy_mps", 0) for r in records]
    return {
        "vx_mean": float(np.mean(vx)),
        "vx_std" : float(np.std(vx)),
        "vy_mean": float(np.mean(vy)),
        "vy_std" : float(np.std(vy)),
    }


def main(results_path: str, out_path: str):
    with open(results_path) as f:
        r = json.load(f)

    records    = r["records"]
    foot_names = r["foot_names"]
    sim_freq   = r.get("sim_step_freq_hz")
    sim_duty   = r.get("sim_duty_cycle") or {}
    target_v   = r.get("target_speed_mps")

    contact_stats = compute_contact_stats(records, foot_names)
    vel_stats     = compute_velocity_stats(records)

    feedback = []

    lines = [
        "# Test 05 — Gait Analysis Report",
        "",
        f"**Duration**: {r['gait_duration_s']}s  |  "
        f"**Rate**: {r['control_hz']} Hz  |  "
        f"**Target speed**: {target_v} m/s",
        "",
        "## Velocity",
        "",
        f"| | Mean | Std |",
        f"|---|---|---|",
        f"| vx (m/s) | {vel_stats['vx_mean']:.3f} | {vel_stats['vx_std']:.3f} |",
        f"| vy (m/s) | {vel_stats['vy_mean']:.3f} | {vel_stats['vy_std']:.3f} |",
        "",
    ]

    if target_v and abs(vel_stats["vx_mean"] - target_v) > 0.1 * target_v:
        feedback.append(
            f"- **FB-G1**: Actual forward speed ({vel_stats['vx_mean']:.2f} m/s) "
            f"deviates >10% from target ({target_v} m/s). "
            f"Check speed command, foot slip, or motor saturation."
        )

    lines += [
        "## Gait Metrics per Foot",
        "",
        "| Foot | Duty Cycle | Step Freq (Hz) | Sim Freq | Δ Freq | "
        "Stance (s) | Swing (s) |",
        "|------|-----------|----------------|----------|--------|"
        "-----------|----------|",
    ]

    freq_vals = []
    for foot in foot_names:
        s     = contact_stats[foot]
        sim_d = sim_duty.get(foot)
        freq  = s["step_freq_hz"]
        freq_vals.append(freq)
        delta = f"{freq - sim_freq:+.2f}" if sim_freq else "—"
        sim_f = f"{sim_freq:.2f}" if sim_freq else "—"
        stance= f"{s['mean_stance_s']:.3f}" if s["mean_stance_s"] else "—"
        swing = f"{s['mean_swing_s']:.3f}"  if s["mean_swing_s"]  else "—"

        lines.append(
            f"| {foot} | {s['duty_cycle']:.2f} | {freq:.2f} | {sim_f} | "
            f"{delta} | {stance} | {swing} |"
        )

        # Duty cycle mismatch
        if sim_d and abs(s["duty_cycle"] - sim_d) > 0.10:
            feedback.append(
                f"- **FB-G2 [{foot}]**: Duty cycle {s['duty_cycle']:.2f} vs sim "
                f"{sim_d:.2f} (Δ={s['duty_cycle']-sim_d:+.2f}). "
                f"Update `sim_duty_cycle.{foot}` and review contact reward shaping."
            )

    # Symmetry
    if len(foot_names) >= 2:
        freq_arr = np.array(freq_vals)
        sym_cv   = float(freq_arr.std() / freq_arr.mean()) if freq_arr.mean() > 0 else 0
        lines += [
            "",
            f"**Step frequency**: mean={np.mean(freq_vals):.2f} Hz  "
            f"std={np.std(freq_vals):.2f} Hz  CV={sym_cv:.2%}",
            "",
        ]
        if sym_cv > 0.10:
            feedback.append(
                f"- **FB-G3**: High step frequency asymmetry (CV={sym_cv:.2%}). "
                f"Suggests uneven load distribution. Check terrain leveling or "
                f"add symmetry regularization to policy reward."
            )

    if sim_freq:
        avg_freq = float(np.mean(freq_vals))
        gap      = avg_freq - sim_freq
        if abs(gap) > 0.5:
            feedback.append(
                f"- **FB-G4**: Real step frequency ({avg_freq:.2f} Hz) differs from "
                f"sim ({sim_freq:.2f} Hz) by {gap:+.2f} Hz. "
                f"Possible cause: different floor friction or motor response. "
                f"Update `sim_step_freq_hz` and re-examine terrain friction domain randomization."
            )

    lines += ["", "## Design Feedback", ""]
    if feedback:
        lines += feedback
    else:
        lines.append("- Gait pattern within acceptable bounds. No design changes required.")

    lines += ["", "_Generated by analyze.py — Test 05 Gait_"]

    Path(out_path).write_text("\n".join(lines))
    print(f"Report written → {out_path}")
    avg = np.mean([contact_stats[f]["step_freq_hz"] for f in foot_names])
    print(f"Avg step freq: {avg:.2f} Hz  |  vx: {vel_stats['vx_mean']:.3f} m/s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results.json")
    ap.add_argument("--out",     default="report.md")
    args = ap.parse_args()
    main(args.results, args.out)
