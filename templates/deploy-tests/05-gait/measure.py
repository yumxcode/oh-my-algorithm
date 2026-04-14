"""
Test 05: Gait Cycle Analysis
Measures foot contact timing, stride length, step frequency during nominal gait.
Compares gait pattern to sim expectations.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_foot_contacts(), get_base_velocity(), get_joint_positions()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
CONTROL_HZ       = None    # e.g. 50
GAIT_DURATION_S  = 30.0    # seconds of walking to record
TARGET_SPEED_MPS = None    # commanded forward speed (m/s); from design
FOOT_NAMES       = None    # list[str] — e.g. ["LF","RF","LH","RH"]
SIM_STEP_FREQ_HZ = None    # modelled step frequency in sim
SIM_DUTY_CYCLE   = None    # dict: foot → expected duty cycle (fraction in contact)
# ──────────────────────────────────────────────────────────────────────────────


def get_foot_contacts() -> dict:
    """Return dict: foot_name → bool (True = in contact).
    IMPLEMENT: from foot contact sensors or force-torque."""
    raise NotImplementedError("Implement get_foot_contacts()")


def get_base_velocity() -> dict:
    """Return dict: vx_mps, vy_mps, vz_mps.
    IMPLEMENT: from state estimator / odometry."""
    raise NotImplementedError("Implement get_base_velocity()")


def get_joint_positions() -> np.ndarray:
    """Return joint positions (rad) in design-defined order.
    IMPLEMENT: from robot middleware."""
    raise NotImplementedError("Implement get_joint_positions()")


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ, TARGET_SPEED_MPS, FOOT_NAMES, SIM_STEP_FREQ_HZ, SIM_DUTY_CYCLE
    CONTROL_HZ       = cfg.get("control_hz", CONTROL_HZ)
    TARGET_SPEED_MPS = cfg.get("target_speed_mps", TARGET_SPEED_MPS)
    FOOT_NAMES       = cfg.get("foot_names", FOOT_NAMES)
    SIM_STEP_FREQ_HZ = cfg.get("sim_step_freq_hz", SIM_STEP_FREQ_HZ)
    SIM_DUTY_CYCLE   = cfg.get("sim_duty_cycle", SIM_DUTY_CYCLE)

    assert CONTROL_HZ, "control_hz must be set in deploy-config.json"
    assert FOOT_NAMES, "foot_names must be set in deploy-config.json"

    period = 1.0 / CONTROL_HZ
    n      = int(GAIT_DURATION_S * CONTROL_HZ)

    print(f"Recording {GAIT_DURATION_S}s of gait at {CONTROL_HZ} Hz")
    print(f"Target speed: {TARGET_SPEED_MPS} m/s")
    print("Walk the robot at commanded speed during recording.\n")

    records = []
    for i in range(n):
        t        = i * period
        contacts = get_foot_contacts()
        vel      = get_base_velocity()
        joints   = get_joint_positions()
        records.append({
            "t"        : t,
            "contacts" : contacts,
            "velocity" : vel,
            "joints"   : joints.tolist() if isinstance(joints, np.ndarray) else joints,
        })
        time.sleep(period)

    results = {
        "test"            : "05-gait",
        "control_hz"      : CONTROL_HZ,
        "gait_duration_s" : GAIT_DURATION_S,
        "target_speed_mps": TARGET_SPEED_MPS,
        "foot_names"      : FOOT_NAMES,
        "sim_step_freq_hz": SIM_STEP_FREQ_HZ,
        "sim_duty_cycle"  : SIM_DUTY_CYCLE,
        "records"         : records,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("Results saved → results.json")
    print("Run analyze.py to compute gait metrics.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
