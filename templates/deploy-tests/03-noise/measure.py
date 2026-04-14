"""
Test 03: Sensor Noise Characterization
Records raw observation streams (IMU, joint encoders, etc.) at rest and during
slow motion. Characterises noise distribution and compares to sim assumptions.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_observation(), get_imu_raw(), get_joint_positions_raw()

Output: results.json
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG ────────────────────────────────────────────────────────────────────
RECORD_HZ        = None    # sensor polling rate (e.g. 200)
RECORD_DURATION_S = 30.0   # seconds at rest
SIM_NOISE_STD    = None    # dict: sensor_name → std modelled in sim
OBS_NAMES        = None    # list[str] — observation channel names; from design
# ──────────────────────────────────────────────────────────────────────────────


def get_observation() -> np.ndarray:
    """Return full observation vector as numpy array.
    IMPLEMENT: read from robot middleware."""
    raise NotImplementedError("Implement get_observation()")


def get_imu_raw() -> dict:
    """Return dict with keys: gyro_xyz (rad/s), accel_xyz (m/s²).
    IMPLEMENT: read directly from IMU driver."""
    raise NotImplementedError("Implement get_imu_raw()")


def get_joint_positions_raw() -> np.ndarray:
    """Return raw joint encoder readings (rad).
    IMPLEMENT: read from encoder driver (unfiltered)."""
    raise NotImplementedError("Implement get_joint_positions_raw()")


def record_stream(name: str, fn, n_samples: int) -> dict:
    period = 1.0 / RECORD_HZ
    samples = []
    print(f"  Recording {name} ({n_samples} samples)...", end=" ", flush=True)
    for _ in range(n_samples):
        val = fn()
        if isinstance(val, np.ndarray):
            samples.append(val.tolist())
        elif isinstance(val, dict):
            samples.append(val)
        else:
            samples.append(float(val))
        time.sleep(period)
    print("done")
    return {"name": name, "samples": samples}


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global RECORD_HZ, SIM_NOISE_STD, OBS_NAMES
    RECORD_HZ     = cfg.get("control_hz", RECORD_HZ)
    SIM_NOISE_STD = cfg.get("sim_noise_std", SIM_NOISE_STD)
    OBS_NAMES     = cfg.get("obs_names", OBS_NAMES)

    assert RECORD_HZ, "control_hz must be set in deploy-config.json"

    n_samples = int(RECORD_HZ * RECORD_DURATION_S)
    print(f"Recording {RECORD_DURATION_S}s at {RECORD_HZ} Hz = {n_samples} samples")
    print("IMPORTANT: Keep robot stationary / at rest during recording.\n")

    streams = {}

    # Full observation vector
    obs_stream = record_stream("observation", get_observation, n_samples)
    streams["observation"] = obs_stream

    # IMU raw
    imu_stream = record_stream("imu_raw", get_imu_raw, n_samples)
    streams["imu_raw"] = imu_stream

    # Joint encoders
    enc_stream = record_stream("joint_positions_raw", get_joint_positions_raw, n_samples)
    streams["joint_positions_raw"] = enc_stream

    results = {
        "test"              : "03-noise",
        "record_hz"         : RECORD_HZ,
        "record_duration_s" : RECORD_DURATION_S,
        "n_samples"         : n_samples,
        "sim_noise_std"     : SIM_NOISE_STD,
        "obs_names"         : OBS_NAMES,
        "streams"           : streams,
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print("\nResults saved → results.json")
    print("Run analyze.py to compare noise distribution vs sim model.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
