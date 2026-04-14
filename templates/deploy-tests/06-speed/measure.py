"""
Test 06: Speed Tracking
Commands a ramp of speeds and measures tracking error, slip, and oscillation.
Identifies maximum stable speed and compares to design target.

Usage: python measure.py --config ../../deploy-config.json
Fill in: set_target_velocity(), get_base_velocity(), get_foot_contacts()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
CONTROL_HZ      = None     # e.g. 50
SPEED_STEPS_MPS = None     # list[float] — ramp of speeds, e.g. [0.2, 0.4, 0.8, 1.2, 1.6]
HOLD_DURATION_S = 10.0     # seconds at each speed level
RAMP_DURATION_S = 2.0      # seconds to ramp between speed levels
FOOT_NAMES      = None     # list[str]
DESIGN_MAX_SPEED= None     # m/s — design's target maximum speed
# ──────────────────────────────────────────────────────────────────────────────


def set_target_velocity(vx: float, vy: float = 0.0, omega: float = 0.0):
    """Send velocity command to the policy / low-level controller.
    IMPLEMENT: publish to your velocity command interface."""
    raise NotImplementedError("Implement set_target_velocity()")


def get_base_velocity() -> dict:
    """Return dict: vx_mps, vy_mps, vz_mps.
    IMPLEMENT: from state estimator / odometry."""
    raise NotImplementedError("Implement get_base_velocity()")


def get_foot_contacts() -> dict:
    """Return dict: foot_name → bool.
    IMPLEMENT: from contact sensors."""
    raise NotImplementedError("Implement get_foot_contacts()")


def get_base_tilt() -> dict:
    """Return dict: roll_deg, pitch_deg.
    IMPLEMENT: from IMU."""
    raise NotImplementedError("Implement get_base_tilt()")


def record_at_speed(target_v: float, duration_s: float, hz: float) -> dict:
    """Hold target speed and record response."""
    period = 1.0 / hz
    n      = int(duration_s * hz)
    set_target_velocity(target_v)

    records = []
    fell    = False
    for _ in range(n):
        vel  = get_base_velocity()
        tilt = get_base_tilt()
        ctc  = get_foot_contacts()
        records.append({
            "vx_mps"  : vel.get("vx_mps", 0),
            "vy_mps"  : vel.get("vy_mps", 0),
            "roll_deg": tilt.get("roll_deg", 0),
            "pitch_deg": tilt.get("pitch_deg", 0),
            "contacts": ctc,
        })
        if abs(tilt.get("roll_deg", 0)) > 35 or abs(tilt.get("pitch_deg", 0)) > 35:
            fell = True
            break
        time.sleep(period)

    set_target_velocity(0.0)
    time.sleep(2.0)

    vx_arr = np.array([s["vx_mps"] for s in records])
    return {
        "target_mps"  : target_v,
        "achieved_mean": float(vx_arr.mean()),
        "achieved_std" : float(vx_arr.std()),
        "tracking_err" : float(abs(vx_arr.mean() - target_v)),
        "fell"         : fell,
        "records"      : records,
    }


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ, SPEED_STEPS_MPS, FOOT_NAMES, DESIGN_MAX_SPEED
    CONTROL_HZ       = cfg.get("control_hz", CONTROL_HZ)
    SPEED_STEPS_MPS  = cfg.get("speed_steps_mps", SPEED_STEPS_MPS)
    FOOT_NAMES       = cfg.get("foot_names", FOOT_NAMES)
    DESIGN_MAX_SPEED = cfg.get("design_max_speed_mps", DESIGN_MAX_SPEED)

    assert CONTROL_HZ,      "control_hz must be set in deploy-config.json"
    assert SPEED_STEPS_MPS, "speed_steps_mps must be set in deploy-config.json"

    trials = []
    max_stable_v = 0.0

    for v in SPEED_STEPS_MPS:
        print(f"  Speed {v:.2f} m/s...", end=" ", flush=True)
        trial = record_at_speed(v, HOLD_DURATION_S, CONTROL_HZ)
        trials.append(trial)
        if not trial["fell"]:
            max_stable_v = v
        print(f"achieved={trial['achieved_mean']:.2f}m/s  "
              f"err={trial['tracking_err']:.3f}  "
              f"{'FALL' if trial['fell'] else 'ok'}")
        if trial["fell"]:
            print("  ⚠️  Fall detected — stopping speed ramp.")
            break

    results = {
        "test"             : "06-speed",
        "control_hz"       : CONTROL_HZ,
        "speed_steps_mps"  : SPEED_STEPS_MPS,
        "hold_duration_s"  : HOLD_DURATION_S,
        "foot_names"       : FOOT_NAMES,
        "design_max_speed" : DESIGN_MAX_SPEED,
        "max_stable_speed" : max_stable_v,
        "trials"           : trials,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nMax stable speed: {max_stable_v:.2f} m/s "
          f"(design target: {DESIGN_MAX_SPEED})")
    print("Results saved → results.json")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
