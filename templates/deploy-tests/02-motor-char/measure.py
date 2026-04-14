"""
Test 02: Motor Characterization (Kp / Kd Identification)
Applies step commands to each joint and records position/velocity response.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_joint_state(), send_joint_command(), safe_home_position()

Output: results.json in this directory.
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG (filled in by $deploy Phase 3) ─────────────────────────────────────
JOINT_NAMES     = None   # list[str] — e.g. ["LHipYaw","LHipRoll",...]; from design
KP_SIM          = None   # dict[str, float] — sim Kp values per joint
KD_SIM          = None   # dict[str, float] — sim Kd values per joint
STEP_AMPLITUDE  = 0.10   # rad — step size (keep small for safety)
STEP_DURATION_S = 1.0    # seconds to record after step
CONTROL_HZ      = None   # e.g. 500 Hz — low-level control rate
N_REPEATS       = 5      # repetitions per joint for averaging
REST_S          = 2.0    # seconds at home position between steps
# ──────────────────────────────────────────────────────────────────────────────


def safe_home_position() -> dict:
    """Return dict mapping joint_name → target_position_rad at safe home.
    IMPLEMENT: read from robot URDF / config."""
    raise NotImplementedError("Implement safe_home_position()")


def get_joint_state() -> dict:
    """Return {'positions': {joint: rad}, 'velocities': {joint: rad_s}}.
    IMPLEMENT: read from robot middleware."""
    raise NotImplementedError("Implement get_joint_state()")


def send_joint_command(positions: dict):
    """Send position targets to robot joints.
    positions: dict mapping joint_name → target_rad
    IMPLEMENT: publish to your robot's position control interface."""
    raise NotImplementedError("Implement send_joint_command()")


def record_step_response(joint: str, home: dict, amplitude: float,
                         duration_s: float, hz: float) -> dict:
    """Apply one position step to `joint`, record response."""
    period_s = 1.0 / hz
    n_steps  = int(duration_s * hz)

    # Return to home
    send_joint_command(home)
    time.sleep(REST_S)

    # Apply step
    target = dict(home)
    target[joint] = home.get(joint, 0.0) + amplitude

    timestamps   = []
    positions    = []
    velocities   = []
    t_step       = time.perf_counter()

    for _ in range(n_steps):
        send_joint_command(target)
        t = time.perf_counter() - t_step
        state = get_joint_state()
        timestamps.append(t)
        positions.append(state["positions"].get(joint, float("nan")))
        velocities.append(state["velocities"].get(joint, float("nan")))
        time.sleep(period_s)

    # Return home
    send_joint_command(home)

    return {
        "joint"        : joint,
        "amplitude_rad": amplitude,
        "timestamps_s" : timestamps,
        "positions_rad": positions,
        "velocities_rads": velocities,
    }


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global JOINT_NAMES, KP_SIM, KD_SIM, CONTROL_HZ
    JOINT_NAMES = cfg.get("joint_names", JOINT_NAMES)
    KP_SIM      = cfg.get("kp_sim", KP_SIM)
    KD_SIM      = cfg.get("kd_sim", KD_SIM)
    CONTROL_HZ  = cfg.get("control_hz", CONTROL_HZ)

    assert JOINT_NAMES, "joint_names must be set in deploy-config.json"
    assert CONTROL_HZ,  "control_hz must be set in deploy-config.json"

    home   = safe_home_position()
    trials = {}   # joint → list of trial dicts

    for joint in JOINT_NAMES:
        print(f"\n── Joint: {joint} ──────────────────────────")
        trials[joint] = []
        for rep in range(N_REPEATS):
            print(f"  Rep {rep+1}/{N_REPEATS}...", end=" ", flush=True)
            trial = record_step_response(
                joint, home, STEP_AMPLITUDE, STEP_DURATION_S, CONTROL_HZ
            )
            trials[joint].append(trial)
            print("done")

    results = {
        "test"         : "02-motor-char",
        "joint_names"  : JOINT_NAMES,
        "kp_sim"       : KP_SIM,
        "kd_sim"       : KD_SIM,
        "control_hz"   : CONTROL_HZ,
        "step_amplitude_rad": STEP_AMPLITUDE,
        "step_duration_s"   : STEP_DURATION_S,
        "n_repeats"         : N_REPEATS,
        "trials"            : trials,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\nResults saved → results.json")
    print(f"Joints tested: {', '.join(JOINT_NAMES)}")
    print("Run analyze.py to fit Kp/Kd and generate report.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
