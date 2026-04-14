"""
Test 07: External Disturbance Rejection
Tests recovery from payload changes, external forces applied while walking,
and sudden load shifts. Measures recovery distance and time.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_base_state(), get_base_velocity(), set_target_velocity()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
CONTROL_HZ        = None    # e.g. 50
WALK_SPEED_MPS    = None    # forward speed during test
DISTURBANCE_TYPES = [       # types of disturbances to test
    "lateral_push",         # sideways push while walking
    "frontal_push",         # forward/backward push while walking
    "payload_add",          # add a known weight (manual)
    "payload_remove",       # remove added weight (manual)
    "slope_entry",          # walk onto inclined surface (manual)
]
N_TRIALS_PER_TYPE = 5
RECORD_WINDOW_S   = 10.0    # seconds around each disturbance
FALL_TILT_DEG     = 30.0
# ──────────────────────────────────────────────────────────────────────────────


def get_base_state() -> dict:
    """Return dict: roll_deg, pitch_deg, yaw_deg, height_m.
    IMPLEMENT: from IMU + estimator."""
    raise NotImplementedError("Implement get_base_state()")


def get_base_velocity() -> dict:
    """Return dict: vx_mps, vy_mps.
    IMPLEMENT: from odometry / state estimator."""
    raise NotImplementedError("Implement get_base_velocity()")


def set_target_velocity(vx: float, vy: float = 0.0):
    """Send velocity command.
    IMPLEMENT: to your velocity command interface."""
    raise NotImplementedError("Implement set_target_velocity()")


def record_window(duration_s: float, hz: float) -> list:
    """Record base state for duration_s seconds."""
    period = 1.0 / hz
    n      = int(duration_s * hz)
    records= []
    for _ in range(n):
        s = get_base_state()
        v = get_base_velocity()
        records.append({**s, **v, "t": time.perf_counter()})
        time.sleep(period)
    return records


def run_disturbance_trial(dist_type: str, walk_speed: float,
                          window_s: float, hz: float) -> dict:
    """Execute one disturbance trial."""
    set_target_velocity(walk_speed)
    time.sleep(2.0)  # settle

    print(f"    Recording pre-disturbance ({window_s/2:.0f}s)...", end=" ", flush=True)
    pre_records  = record_window(window_s / 2, hz)
    print("done")

    # Operator-triggered disturbance
    print(f"    >>> APPLY {dist_type.upper()} NOW <<<")
    input("    Press ENTER immediately after applying disturbance...")
    t_dist = time.perf_counter()

    print(f"    Recording post-disturbance ({window_s/2:.0f}s)...", end=" ", flush=True)
    post_records = record_window(window_s / 2, hz)
    print("done")

    set_target_velocity(0.0)
    time.sleep(2.0)

    # Detect fall
    fell = any(
        abs(s.get("roll_deg", 0)) > FALL_TILT_DEG or
        abs(s.get("pitch_deg", 0)) > FALL_TILT_DEG
        for s in post_records
    )

    # Max tilt post-disturbance
    max_tilt = max(
        (max(abs(s.get("roll_deg", 0)), abs(s.get("pitch_deg", 0)))
         for s in post_records),
        default=0.0
    )

    return {
        "disturbance_type"  : dist_type,
        "walk_speed_mps"    : walk_speed,
        "pre_records"       : pre_records,
        "post_records"      : post_records,
        "fell"              : fell,
        "max_tilt_deg"      : float(max_tilt),
    }


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ, WALK_SPEED_MPS
    CONTROL_HZ     = cfg.get("control_hz", CONTROL_HZ)
    WALK_SPEED_MPS = cfg.get("target_speed_mps", WALK_SPEED_MPS)

    assert CONTROL_HZ,     "control_hz must be set in deploy-config.json"
    assert WALK_SPEED_MPS, "target_speed_mps must be set in deploy-config.json"

    all_trials = {}
    for dist_type in DISTURBANCE_TYPES:
        all_trials[dist_type] = []
        print(f"\n── {dist_type} ({N_TRIALS_PER_TYPE} trials) ──")
        for i in range(N_TRIALS_PER_TYPE):
            print(f"  Trial {i+1}/{N_TRIALS_PER_TYPE}")
            trial = run_disturbance_trial(
                dist_type, WALK_SPEED_MPS, RECORD_WINDOW_S, CONTROL_HZ
            )
            all_trials[dist_type].append(trial)
            if trial["fell"]:
                print("  ⚠️  Fall — continuing to next trial.")
            time.sleep(3.0)

    results = {
        "test"              : "07-disturbance",
        "control_hz"        : CONTROL_HZ,
        "walk_speed_mps"    : WALK_SPEED_MPS,
        "disturbance_types" : DISTURBANCE_TYPES,
        "n_trials_per_type" : N_TRIALS_PER_TYPE,
        "record_window_s"   : RECORD_WINDOW_S,
        "fall_tilt_deg"     : FALL_TILT_DEG,
        "trials"            : all_trials,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\nResults saved → results.json")
    for dt, ts in all_trials.items():
        falls = sum(1 for t in ts if t["fell"])
        print(f"  {dt}: {falls}/{len(ts)} falls")
    print("Run analyze.py to generate report.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
