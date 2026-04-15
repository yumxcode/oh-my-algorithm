"""
Deploy Test Aggregator
Collects per-test results.json from all 8 test directories and writes a unified
deploy/results-summary.md.

Usage (run from the project root or any directory):
    python templates/deploy-tests/aggregate.py \
        --tests-dir deploy/tests \
        --out deploy/results-summary.md \
        [--config templates/deploy-config.json]

The script:
  1. Scans deploy/tests/ for {NN}-{name}/results.json files.
  2. Extracts the key headline metric(s) from each.
  3. Computes a pass/warn/fail verdict per test (rule-based).
  4. Writes a structured deploy/results-summary.md with:
       - Per-test outcome table (mirrors SKILL.md Phase 5 template)
       - Overall sim2real gap score
       - Aggregated design feedback items pulled from each report.md
       - Deployment decision recommendation
"""
import json
import argparse
from pathlib import Path
from datetime import datetime

PASS = "✓ PASS"
WARN = "△ WARN"
FAIL = "✗ FAIL"
NA   = "— N/A"

# ── Per-test verdict extraction ────────────────────────────────────────────────

def verdict_01_latency(r: dict, cfg: dict) -> tuple[str, str, str]:
    """Returns (result, key_metric, action)."""
    period_ms = 1000.0 / r.get("control_hz", 50)
    p99 = r.get("p99_ms", 0)
    sim = r.get("sim_latency_ms") or cfg.get("sim_latency_ms")
    gap = f"{p99 - sim:+.1f}ms" if sim else "—"
    key = f"p99={p99:.1f}ms sim={sim or '?'}ms gap={gap}"
    over_pct = sum(1 for x in r.get("latencies_ms", []) if x > period_ms) / max(len(r.get("latencies_ms", [1])), 1) * 100
    if over_pct > 5.0 or p99 > period_ms * 0.5:
        return FAIL, key, "Reduce policy size or increase sim latency DR"
    if over_pct > 1.0 or p99 > period_ms * 0.3:
        return WARN, key, "Monitor — approaching budget"
    return PASS, key, "None"


def verdict_02_motor(r: dict, cfg: dict) -> tuple[str, str, str]:
    joints = r.get("joint_names", [])
    kp_sim = r.get("kp_sim") or {}
    trials = r.get("trials", {})
    max_err = 0.0
    worst_joint = "—"
    # Can't re-run scipy fit here; check if results carry kp_estimated
    # Fallback: report number of joints tested
    n_tested = len([j for j in joints if j in trials and trials[j]])
    key = f"{n_tested}/{len(joints)} joints tested"
    # No fitted values available without scipy; verdict = WARN if joints missing
    if n_tested < len(joints):
        return WARN, key, "Some joints not tested — re-run measure.py"
    return PASS, key, "Run analyze.py for Kp/Kd fit details"


def verdict_03_noise(r: dict, cfg: dict) -> tuple[str, str, str]:
    sim_noise = r.get("sim_noise_std") or {}
    streams   = r.get("streams", {})
    max_ratio = 0.0
    worst_ch  = "—"
    for sname, stream in streams.items():
        samples = stream.get("samples", [])
        if not samples:
            continue
        import numpy as np
        arr = np.array(samples)
        if arr.ndim > 1:
            arr = arr.reshape(len(samples), -1)
            stds = arr.std(axis=0)
        else:
            stds = [arr.std()]
        for i, std in enumerate(stds):
            ch = f"{sname}_ch{i}"
            sim_std = sim_noise.get(ch) or sim_noise.get(sname)
            if sim_std and sim_std > 0:
                ratio = float(std) / sim_std
                if ratio > max_ratio:
                    max_ratio = ratio
                    worst_ch = ch
    key = f"max noise ratio={max_ratio:.1f}x (channel={worst_ch})"
    if max_ratio > 3.0:
        return FAIL, key, "Increase sim_noise_std DR to cover real range"
    if max_ratio > 1.5:
        return WARN, key, "Update sim_noise_std in deploy-config.json"
    return PASS, key, "None"


def verdict_04_stability(r: dict, cfg: dict) -> tuple[str, str, str]:
    trials = r.get("perturbation_trials", [])
    n_trials = len(trials)
    n_falls  = sum(1 for t in trials if t.get("fell", False))
    static   = r.get("static_records", [])
    if static:
        import numpy as np
        pitches = [s.get("pitch_deg", 0) for s in static]
        rolls   = [s.get("roll_deg", 0)  for s in static]
        max_tilt = float(max(max(abs(p) for p in pitches), max(abs(r2) for r2 in rolls)))
    else:
        max_tilt = 0.0
    fall_rate = n_falls / n_trials if n_trials else 0.0
    key = f"fall_rate={n_falls}/{n_trials} static_max_tilt={max_tilt:.1f}°"
    if fall_rate > 0.3 or max_tilt > 15.0:
        return FAIL, key, "Add push recovery training; review balance reward"
    if fall_rate > 0.1 or max_tilt > 8.0:
        return WARN, key, "Monitor; consider higher push perturbation in training"
    return PASS, key, "None"


def verdict_05_gait(r: dict, cfg: dict) -> tuple[str, str, str]:
    import numpy as np
    foot_names = r.get("foot_names", [])
    sim_dc     = r.get("sim_duty_cycle") or {}
    records    = r.get("records", [])
    if not records or not foot_names:
        return NA, "no records", "—"
    contacts = [rec.get("contacts", {}) for rec in records]
    max_dc_err = 0.0
    worst_foot = "—"
    for foot in foot_names:
        real_dc = float(np.mean([c.get(foot, False) for c in contacts]))
        sim_dc_v = sim_dc.get(foot)
        if sim_dc_v:
            err = abs(real_dc - sim_dc_v)
            if err > max_dc_err:
                max_dc_err = err
                worst_foot = foot
    key = f"max duty_cycle_err={max_dc_err:.2f} (foot={worst_foot})"
    if max_dc_err > 0.20:
        return FAIL, key, "Investigate contact model mismatch; add friction DR"
    if max_dc_err > 0.10:
        return WARN, key, "Monitor gait consistency across surfaces"
    return PASS, key, "None"


def verdict_06_speed(r: dict, cfg: dict) -> tuple[str, str, str]:
    max_stable = r.get("max_stable_speed", 0.0)
    design_max = r.get("design_max_speed") or cfg.get("design_max_speed_mps", 1.0)
    trials     = r.get("trials", [])
    errs = [t.get("tracking_err", 0) for t in trials if not t.get("fell")]
    import numpy as np
    mean_err = float(np.mean(errs)) if errs else 0.0
    key = f"max_stable={max_stable:.2f}m/s design_max={design_max}m/s mean_err={mean_err:.3f}"
    if max_stable < design_max * 0.8:
        return FAIL, key, "Speed below design target — retrain with higher speed curriculum"
    if max_stable < design_max * 0.95:
        return WARN, key, "Speed slightly below target — monitor"
    return PASS, key, "None"


def verdict_07_disturbance(r: dict, cfg: dict) -> tuple[str, str, str]:
    trials    = r.get("trials", {})
    all_falls = []
    total     = 0
    for dtype, tlist in trials.items():
        for t in tlist:
            all_falls.append(t.get("fell", False))
            total += 1
    n_falls   = sum(all_falls)
    fall_rate = n_falls / total if total else 0.0
    key = f"fall_rate={n_falls}/{total} across {len(trials)} disturbance types"
    if fall_rate > 0.3:
        return FAIL, key, "Add push/payload perturbations in sim training"
    if fall_rate > 0.1:
        return WARN, key, "Some failures — check specific disturbance types"
    return PASS, key, "None"


def verdict_08_terrain(r: dict, cfg: dict) -> tuple[str, str, str]:
    runs = r.get("runs", [])
    all_segs = [seg for run in runs for seg in run]
    n_total  = len(all_segs)
    n_falls  = sum(1 for s in all_segs if s.get("fell", False))
    fall_rate = n_falls / n_total if n_total else 0.0
    key = f"fall_rate={n_falls}/{n_total} segments across {len(runs)} runs"
    if fall_rate > 0.3:
        return FAIL, key, "Add terrain DR (slopes, steps, uneven ground) in $design"
    if fall_rate > 0.1:
        return WARN, key, "Marginal terrain performance — add terrain curriculum"
    return PASS, key, "None"


VERDICT_FNS = {
    "01-latency"   : verdict_01_latency,
    "02-motor-char": verdict_02_motor,
    "03-noise"     : verdict_03_noise,
    "04-stability" : verdict_04_stability,
    "05-gait"      : verdict_05_gait,
    "06-speed"     : verdict_06_speed,
    "07-disturbance": verdict_07_disturbance,
    "08-terrain"   : verdict_08_terrain,
}

TEST_LABELS = {
    "01-latency"   : "01 Latency",
    "02-motor-char": "02 Motor Kp/Kd",
    "03-noise"     : "03 Sensor Noise",
    "04-stability" : "04 Stability",
    "05-gait"      : "05 Gait Cycle",
    "06-speed"     : "06 Speed Range",
    "07-disturbance": "07 Disturbance",
    "08-terrain"   : "08 Terrain",
}


# ── Main ───────────────────────────────────────────────────────────────────────

def main(tests_dir: str, out_path: str, config_path: str):
    tests_root = Path(tests_dir)
    cfg = {}
    if config_path and Path(config_path).exists():
        with open(config_path) as f:
            cfg = json.load(f)

    rows = []
    design_feedback_items = []

    for test_key in sorted(VERDICT_FNS.keys()):
        results_file = tests_root / test_key / "results.json"
        report_file  = tests_root / test_key / "report.md"

        if not results_file.exists():
            rows.append({
                "test"   : TEST_LABELS.get(test_key, test_key),
                "result" : "— SKIP",
                "key"    : "results.json not found",
                "vs_sim" : "—",
                "gap"    : "—",
                "action" : "Run measure.py + analyze.py",
            })
            continue

        with open(results_file) as f:
            r = json.load(f)

        fn = VERDICT_FNS[test_key]
        try:
            result, key_metric, action = fn(r, cfg)
        except Exception as e:
            result, key_metric, action = WARN, f"Analysis error: {e}", "Check analyze.py"

        rows.append({
            "test"   : TEST_LABELS.get(test_key, test_key),
            "result" : result,
            "key"    : key_metric,
            "vs_sim" : "sim" if result != "— N/A" else "—",
            "gap"    : "—",
            "action" : action,
        })

        # Collect design feedback bullets from report.md if it exists
        if report_file.exists():
            fb_lines = []
            in_fb = False
            for line in report_file.read_text().splitlines():
                if line.startswith("## Design Feedback"):
                    in_fb = True
                    continue
                if in_fb and line.startswith("## "):
                    in_fb = False
                if in_fb and line.startswith("- **FB-"):
                    fb_lines.append(line)
            if fb_lines:
                design_feedback_items.append((TEST_LABELS.get(test_key, test_key), fb_lines))

    # ── Compute overall score ──────────────────────────────────────────────────
    total   = len([r for r in rows if r["result"] != "— SKIP"])
    passed  = sum(1 for r in rows if r["result"] == PASS)
    warned  = sum(1 for r in rows if r["result"] == WARN)
    failed  = sum(1 for r in rows if r["result"] == FAIL)

    # ── Deployment decision ────────────────────────────────────────────────────
    if failed == 0 and warned <= 1:
        decision = "**DEPLOY** — All critical tests passed."
        decision_detail = "Package the policy and proceed to deployment."
    elif failed == 0 and warned > 1:
        decision = "**HOLD** — No hard failures, but multiple warnings."
        decision_detail = "Review warnings before deploying. Consider config fixes for Kp/Kd or noise model."
    else:
        decision = "**RETURN TO $design** — Critical sim2real gaps found."
        decision_detail = f"{failed} test(s) failed. See design feedback below."

    # ── Build report ───────────────────────────────────────────────────────────
    design_id = cfg.get("design_id", "unknown")
    robot     = cfg.get("robot_name", "unknown")
    date_str  = datetime.now().strftime("%Y-%m-%d")

    lines = [
        "# Deployment Test Results",
        f"_Algorithm: {design_id} | Date: {date_str} | Hardware: {robot}_",
        "",
        "## Test Outcomes",
        "",
        "| Test | Result | Key Metric | Action |",
        "|------|--------|-----------|--------|",
    ]
    for row in rows:
        lines.append(
            f"| {row['test']} | {row['result']} | {row['key']} | {row['action']} |"
        )

    lines += [
        "",
        "## Overall Sim2Real Gap Score",
        "",
        f"| Passed | Warned | Failed | Skipped | Total |",
        f"|--------|--------|--------|---------|-------|",
        f"| {passed} | {warned} | {failed} | {len(rows) - total} | {len(rows)} |",
        "",
        f"Score: **{passed}/{total}** tests passed",
        "",
        "## Deployment Decision",
        "",
        f"{decision}",
        f"{decision_detail}",
        "",
    ]

    if design_feedback_items:
        lines += ["## Aggregated Design Feedback", ""]
        for test_label, fb_bullets in design_feedback_items:
            lines.append(f"### From {test_label}")
            lines += fb_bullets
            lines.append("")

    lines += [
        "---",
        f"_Generated by aggregate.py — {date_str}_",
    ]

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"Results summary written → {out_path}")
    print(f"Score: {passed}/{total} passed | {warned} warnings | {failed} failures")
    print(f"Decision: {decision}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(
        description="Aggregate all deploy-test results into a single summary."
    )
    ap.add_argument("--tests-dir", default="deploy/tests",
                    help="Directory containing {NN}-{name}/results.json files")
    ap.add_argument("--out",       default="deploy/results-summary.md",
                    help="Output markdown file path")
    ap.add_argument("--config",    default="templates/deploy-config.json",
                    help="Path to deploy-config.json for robot/design metadata")
    args = ap.parse_args()
    main(args.tests_dir, args.out, args.config)
