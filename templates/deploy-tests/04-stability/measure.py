"""
Test 04: Static & Dynamic Stability
Measures balance stability: CoM drift, base tilt, recovery time after small
perturbations while standing / walking in place.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_base_state(), apply_perturbation()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
CONTROL_HZ           = None    # e.g. 50
STATIC_DURATION_S    = 30.0    # seconds of static standing
PERTURB_FORCE_N      = 20.0    # magnitude of perturbation force (if applicable)
PERTURB_DURATION_MS  = 100     # duration of push impulse in ms
N_PERTURBATIONS      = 10      # number of perturbation trials
RECOVERY_WINDOW_S    = 5.0     # time window to assess recovery
FALL_TILT_DEG        = 30.0    # base tilt threshold → classify as fall
# ──────────────────────────────────────────────────────────────────────────────


def get_base_state() -> dict:
    """Return dict: roll_deg, pitch_deg, yaw_deg, height_m, vx, vy, vz.
    IMPLEMENT: from IMU + base pose estimator."""
    raise NotImplementedError("Implement get_base_state()")


def apply_perturbation(force_n: float, direction: str = "forward"):
    """Apply an external impulse push to the robot.
    direction: 'forward' | 'backward' | 'left' | 'right'
    IMPLEMENT: call your perturbation actuator or alert operator to push."""
    raise NotImplementedError("Implement apply_perturbation()")


def record_static(duration_s: float, hz: float) -> list:
    """Record base state for `duration_s` seconds."""
    period  = 1.0 / hz
    n       = int(duration_s * hz)
    records = []
    print(f"  Static standing ({duration_s}s)...", end=" ", flush=True)
    for _ in range(n):
        records.append(get_base_state())
        time.sleep(period)
    print("done")
    return records


def record_perturbation_trial(force_n: float, direction: str,
                              window_s: float, hz: float) -> dict:
    """Apply one push and record recovery trajectory."""
    period = 1.0 / hz
    n      = int(window_s * hz)

    pre_state   = get_base_state()
    apply_perturbation(force_n, direction)
    t_perturb   = time.perf_counter()

    trajectory  = []
    fell        = False
    for _ in range(n):
        s = get_base_state()
        t = time.perf_counter() - t_perturb
        trajectory.append({"t": t, **s})
        if abs(s.get("roll_deg", 0)) > FALL_TILT_DEG or \
           abs(s.get("pitch_deg", 0)) > FALL_TILT_DEG:
            fell = True
            break
        time.sleep(period)

    return {
        "direction"  : direction,
        "force_n"    : force_n,
        "pre_state"  : pre_state,
        "trajectory" : trajectory,
        "fell"       : fell,
    }


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ
    CONTROL_HZ = cfg.get("control_hz", CONTROL_HZ)
    assert CONTROL_HZ, "control_hz must be set in deploy-config.json"

    results = {
        "test"               : "04-stability",
        "control_hz"         : CONTROL_HZ,
        "static_duration_s"  : STATIC_DURATION_S,
        "perturb_force_n"    : PERTURB_FORCE_N,
        "n_perturbations"    : N_PERTURBATIONS,
        "fall_tilt_deg"      : FALL_TILT_DEG,
        "static_records"     : [],
        "perturbation_trials": [],
    }

    # ── Phase 1: Static standing ───────────────────────────────────────────
    print("Phase 1: Static standing...")
    results["static_records"] = record_static(STATIC_DURATION_S, CONTROL_HZ)

    # ── Phase 2: Perturbation trials ──────────────────────────────────────
    print(f"\nPhase 2: {N_PERTURBATIONS} perturbation trials @ {PERTURB_FORCE_N}N")
    directions = ["forward", "backward", "left", "right"]
    for i in range(N_PERTURBATIONS):
        direction = directions[i % len(directions)]
        print(f"  Trial {i+1}/{N_PERTURBATIONS} ({direction})...", end=" ", flush=True)
        input("  Press ENTER when ready to apply perturbation...")
        trial = record_perturbation_trial(
            PERTURB_FORCE_N, direction, RECOVERY_WINDOW_S, CONTROL_HZ
        )
        results["perturbation_trials"].append(trial)
        if trial["fell"]:
            print("  ⚠️  FALL DETECTED — halting perturbation trials.")
            break
        time.sleep(2.0)

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    falls = sum(1 for t in results["perturbation_trials"] if t["fell"])
    print(f"\nResults saved → results.json")
    print(f"Falls: {falls}/{len(results['perturbation_trials'])}")
    print("Run analyze.py to generate report.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
