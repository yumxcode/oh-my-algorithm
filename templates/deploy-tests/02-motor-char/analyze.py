"""
Test 02: Motor Characterization Analysis
Fits a second-order PD model to each joint's step response.
Compares estimated Kp/Kd vs sim settings.

Usage: python analyze.py [--results results.json] [--out report.md]
"""
import json
import argparse
import numpy as np
from pathlib import Path

try:
    from scipy.optimize import curve_fit
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False


def pd_response(t, Kp, Kd, target, init_pos, init_vel=0.0):
    """Analytical second-order PD step response (overdamped approximation).
    q'' = Kp*(target - q) - Kd*q'  →  closed-form for constant target.
    Returns position trajectory."""
    # Solve characteristic equation: s^2 + Kd*s + Kp = 0
    disc = Kd**2 - 4 * Kp
    if disc < 0:
        # Underdamped
        wd = np.sqrt(max(4 * Kp - Kd**2, 1e-9)) / 2
        ws = Kd / 2
        A  = init_pos - target
        B  = (init_vel + ws * A) / wd
        return target + np.exp(-ws * t) * (A * np.cos(wd * t) + B * np.sin(wd * t))
    else:
        # Overdamped / critically damped
        r1 = (-Kd + np.sqrt(max(disc, 0))) / 2
        r2 = (-Kd - np.sqrt(max(disc, 0))) / 2
        if abs(r1 - r2) < 1e-9:
            A = init_pos - target
            B = init_vel - r1 * A
            return target + np.exp(r1 * t) * (A + B * t)
        A = (init_vel - r2 * (init_pos - target)) / (r1 - r2)
        B = (init_pos - target) - A
        return target + A * np.exp(r1 * t) + B * np.exp(r2 * t)


def fit_joint(times, positions, target, init_pos):
    """Fit Kp, Kd to a single step response.
    Returns (Kp_est, Kd_est, rmse) or (None, None, None) on failure."""
    if not HAS_SCIPY:
        return None, None, None
    try:
        def model(t, Kp, Kd):
            return pd_response(t, Kp, Kd, target, init_pos)
        p0      = [50.0, 5.0]
        bounds  = ([0.1, 0.01], [2000.0, 200.0])
        popt, _ = curve_fit(model, times, positions, p0=p0, bounds=bounds,
                            maxfev=5000)
        pred    = model(np.array(times), *popt)
        rmse    = float(np.sqrt(np.mean((np.array(positions) - pred)**2)))
        return float(popt[0]), float(popt[1]), rmse
    except Exception:
        return None, None, None


def settling_time(times, positions, target, tol=0.05):
    """Time (s) for position to stay within tol*|target| of target."""
    band = abs(target) * tol + 1e-6
    pos  = np.array(positions)
    t    = np.array(times)
    in_band = np.abs(pos - target) <= band
    # Find last time it exits the band
    outside = np.where(~in_band)[0]
    if len(outside) == 0:
        return float(t[0])
    return float(t[outside[-1]])


def main(results_path: str, out_path: str):
    with open(results_path) as f:
        r = json.load(f)

    if not HAS_SCIPY:
        print("WARNING: scipy not installed. Kp/Kd fitting disabled. "
              "Install with: pip install scipy --break-system-packages")

    joints    = r["joint_names"]
    kp_sim    = r.get("kp_sim") or {}
    kd_sim    = r.get("kd_sim") or {}
    amplitude = r["step_amplitude_rad"]
    trials    = r["trials"]

    rows = []
    feedback = []

    for joint in joints:
        joint_trials = trials.get(joint, [])
        if not joint_trials:
            continue

        # Average trajectories across repeats (interpolate to common grid)
        all_pos = [np.array(t["positions_rad"]) for t in joint_trials]
        # Use first trial's timestamps as reference
        ref_t   = np.array(joint_trials[0]["timestamps_s"])
        avg_pos = np.mean([p[:len(ref_t)] for p in all_pos], axis=0)

        init_p  = avg_pos[0]
        target  = init_p + amplitude

        kp_est, kd_est, rmse = fit_joint(ref_t.tolist(), avg_pos.tolist(),
                                         target, init_p)
        settle  = settling_time(ref_t.tolist(), avg_pos.tolist(), target)

        kp_s    = kp_sim.get(joint)
        kd_s    = kd_sim.get(joint)
        kp_str  = f"{kp_est:.1f}" if kp_est else "N/A"
        kd_str  = f"{kd_est:.1f}" if kd_est else "N/A"
        kp_diff = f"{(kp_est/kp_s - 1)*100:+.1f}%" if (kp_est and kp_s) else "—"
        kd_diff = f"{(kd_est/kd_s - 1)*100:+.1f}%" if (kd_est and kd_s) else "—"

        rows.append({
            "joint": joint,
            "kp_est": kp_est, "kd_est": kd_est, "rmse": rmse,
            "settle_s": settle,
            "kp_sim": kp_s, "kd_sim": kd_s,
            "kp_diff": kp_diff, "kd_diff": kd_diff,
        })

        # Flag large deviations
        if kp_est and kp_s and abs(kp_est / kp_s - 1) > 0.20:
            feedback.append(
                f"- **FB-M{len(feedback)+1} [{joint}]**: Real Kp ({kp_est:.1f}) "
                f"deviates {kp_diff} from sim Kp ({kp_s}). "
                f"Update `kp_sim.{joint}` in deploy-config.json and re-run "
                f"sim training with corrected gains."
            )
        if kd_est and kd_s and abs(kd_est / kd_s - 1) > 0.25:
            feedback.append(
                f"- **FB-M{len(feedback)+1} [{joint}]**: Real Kd ({kd_est:.1f}) "
                f"deviates {kd_diff} from sim Kd ({kd_s}). "
                f"Consider adding actuator model randomization in $design."
            )
        if settle > 0.5:
            feedback.append(
                f"- **FB-M{len(feedback)+1} [{joint}]**: Settling time {settle:.2f}s "
                f"is slow. Policy may be under-damped for this joint."
            )

    # ── Write report ──────────────────────────────────────────────────────────
    lines = [
        "# Test 02 — Motor Characterization Report",
        "",
        f"**Step amplitude**: {amplitude:.3f} rad  |  "
        f"**Repeats per joint**: {r['n_repeats']}",
        "",
        "## Per-Joint Results",
        "",
        "| Joint | Kp real | Kp sim | Δ Kp | Kd real | Kd sim | Δ Kd | "
        "Settle (s) | Fit RMSE |",
        "|-------|---------|--------|------|---------|--------|------|"
        "-----------|----------|",
    ]

    for row in rows:
        rmse_s   = f"{row['rmse']:.4f}" if row["rmse"] is not None else "N/A"
        settle_s = f"{row['settle_s']:.3f}"
        kp_est_s = f"{row['kp_est']:.1f}" if row["kp_est"] is not None else "N/A"
        kd_est_s = f"{row['kd_est']:.1f}" if row["kd_est"] is not None else "N/A"
        kp_sim_s = str(row["kp_sim"]) if row["kp_sim"] is not None else "—"
        kd_sim_s = str(row["kd_sim"]) if row["kd_sim"] is not None else "—"
        lines.append(
            f"| {row['joint']} | {kp_est_s} | {kp_sim_s} | {row['kp_diff']} | "
            f"{kd_est_s} | {kd_sim_s} | {row['kd_diff']} | "
            f"{settle_s} | {rmse_s} |"
        )

    lines += [
        "",
        "## Design Feedback",
        "",
    ]
    if feedback:
        lines += feedback
    else:
        lines.append("- Kp/Kd within acceptable bounds for all joints. "
                     "No design changes required.")

    lines += [
        "",
        "## Recommendations",
        "",
        "If deviations > 20% are observed:",
        "1. Update `kp_sim` / `kd_sim` in `deploy-config.json` with real values.",
        "2. Re-run sim training with randomized PD gains covering real hardware range.",
        "3. Add per-joint gain adaptation layer to the policy (revisit $design).",
        "",
        "_Generated by analyze.py — Test 02 Motor Characterization_",
    ]

    Path(out_path).write_text("\n".join(lines))
    print(f"Report written → {out_path}")
    if not HAS_SCIPY:
        print("NOTE: Install scipy for Kp/Kd fitting.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results.json")
    ap.add_argument("--out",     default="report.md")
    args = ap.parse_args()
    main(args.results, args.out)
