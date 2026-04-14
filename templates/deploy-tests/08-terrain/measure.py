"""
Test 08: Terrain Traversal
Tests locomotion over structured terrain variations: slopes, steps, gaps,
and unstructured rough ground. Records traversal success, speed, and stability.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_base_state(), get_base_velocity(), set_target_velocity()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
CONTROL_HZ          = None     # e.g. 50
WALK_SPEED_MPS      = None     # commanded forward speed
TERRAIN_SEGMENTS = [           # ordered list of terrain segments to traverse
    {"name": "flat",           "length_m": 3.0},
    {"name": "slope_up_10deg", "length_m": 2.0},
    {"name": "slope_down_10deg","length_m": 2.0},
    {"name": "step_up_5cm",    "length_m": 0.2},
    {"name": "flat_recovery",  "length_m": 2.0},
    {"name": "step_down_5cm",  "length_m": 0.2},
    {"name": "uneven_ground",  "length_m": 3.0},
]
N_TRAVERSALS        = 3        # number of full traversal runs
FALL_TILT_DEG       = 35.0
SEGMENT_TIMEOUT_S   = 30.0     # max time allowed per segment
# ──────────────────────────────────────────────────────────────────────────────


def get_base_state() -> dict:
    """Return dict: roll_deg, pitch_deg, height_m.
    IMPLEMENT: from IMU + estimator."""
    raise NotImplementedError("Implement get_base_state()")


def get_base_velocity() -> dict:
    """Return dict: vx_mps, vy_mps.
    IMPLEMENT: from odometry."""
    raise NotImplementedError("Implement get_base_velocity()")


def set_target_velocity(vx: float, vy: float = 0.0):
    """Send velocity command.
    IMPLEMENT: to your velocity interface."""
    raise NotImplementedError("Implement set_target_velocity()")


def record_segment(segment_name: str, timeout_s: float, hz: float) -> dict:
    """Record traversal of one terrain segment.
    Operator signals segment start/end via keyboard."""
    period  = 1.0 / hz
    records = []
    fell    = False
    t_start = time.perf_counter()

    print(f"    [{segment_name}] Walk robot through segment, press ENTER when segment ends.")
    # Non-blocking: poll until enter pressed or timeout
    import threading
    done = threading.Event()
    threading.Thread(target=lambda: (input(), done.set()), daemon=True).start()

    while not done.is_set() and (time.perf_counter() - t_start) < timeout_s:
        s = get_base_state()
        v = get_base_velocity()
        t = time.perf_counter() - t_start
        records.append({"t": t, **s, **v})
        if abs(s.get("roll_deg", 0)) > FALL_TILT_DEG or \
           abs(s.get("pitch_deg", 0)) > FALL_TILT_DEG:
            fell = True
            done.set()
        time.sleep(period)

    duration = time.perf_counter() - t_start
    if not records:
        return {"segment": segment_name, "fell": fell, "duration_s": duration,
                "records": []}

    vx_arr   = np.array([r.get("vx_mps", 0) for r in records])
    tilt_arr = np.array([max(abs(r.get("roll_deg", 0)), abs(r.get("pitch_deg", 0)))
                         for r in records])
    return {
        "segment"        : segment_name,
        "fell"           : fell,
        "duration_s"     : duration,
        "mean_speed_mps" : float(vx_arr.mean()),
        "mean_tilt_deg"  : float(tilt_arr.mean()),
        "max_tilt_deg"   : float(tilt_arr.max()),
        "records"        : records,
    }


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ, WALK_SPEED_MPS
    CONTROL_HZ     = cfg.get("control_hz", CONTROL_HZ)
    WALK_SPEED_MPS = cfg.get("target_speed_mps", WALK_SPEED_MPS)

    assert CONTROL_HZ,     "control_hz must be set in deploy-config.json"
    assert WALK_SPEED_MPS, "target_speed_mps must be set in deploy-config.json"

    all_runs = []
    for run_idx in range(N_TRAVERSALS):
        print(f"\n══ Traversal run {run_idx+1}/{N_TRAVERSALS} ══")
        run_segments = []
        set_target_velocity(WALK_SPEED_MPS)

        for seg in TERRAIN_SEGMENTS:
            print(f"\n  Segment: {seg['name']} (~{seg['length_m']}m)")
            result = record_segment(seg["name"], SEGMENT_TIMEOUT_S, CONTROL_HZ)
            run_segments.append(result)
            status = "FALL" if result["fell"] else f"{result['mean_speed_mps']:.2f}m/s"
            print(f"    → {status}  max_tilt={result['max_tilt_deg']:.1f}°")
            if result["fell"]:
                print("  ⚠️  Fall — stopping this run.")
                set_target_velocity(0.0)
                break

        set_target_velocity(0.0)
        all_runs.append(run_segments)
        time.sleep(5.0)

    results = {
        "test"             : "08-terrain",
        "control_hz"       : CONTROL_HZ,
        "walk_speed_mps"   : WALK_SPEED_MPS,
        "terrain_segments" : TERRAIN_SEGMENTS,
        "n_traversals"     : N_TRAVERSALS,
        "fall_tilt_deg"    : FALL_TILT_DEG,
        "runs"             : all_runs,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\nResults saved → results.json")
    for i, run in enumerate(all_runs):
        falls = sum(1 for s in run if s["fell"])
        print(f"  Run {i+1}: {falls} fall(s) in {len(run)} segment(s)")
    print("Run analyze.py to generate report.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
