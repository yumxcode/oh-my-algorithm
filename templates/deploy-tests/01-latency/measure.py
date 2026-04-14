"""
Test 01: Latency Measurement
Measures obs→action end-to-end latency of the deployed policy.

Usage: python measure.py --config ../../deploy-config.json
Fill in: get_current_obs(), call_policy() — adapt to your robot's API.

Output: results.json in this directory.
"""
import time
import json
import argparse
import numpy as np

# ── CONFIG (filled in by $deploy Phase 3) ─────────────────────────────────────
CONTROL_HZ      = None   # e.g. 50  — from design
N_WARMUP        = 50     # warm-up iterations (JIT / cache effects)
N_SAMPLES       = 500    # measurement iterations
SIM_LATENCY_MS  = None   # modelled delay from design (for comparison)
# ──────────────────────────────────────────────────────────────────────────────


def get_current_obs():
    """Return current observation vector as numpy array.
    IMPLEMENT: read from robot middleware (ROS topic, shared memory, etc.)"""
    raise NotImplementedError("Implement get_current_obs() for your robot API")


def call_policy(obs: np.ndarray) -> np.ndarray:
    """Run policy inference and return action vector.
    IMPLEMENT: call your deployed policy server / onboard model."""
    raise NotImplementedError("Implement call_policy() for your deployment")


def main(config_path: str):
    with open(config_path) as f:
        cfg = json.load(f)

    global CONTROL_HZ, SIM_LATENCY_MS
    CONTROL_HZ     = cfg.get("control_hz", CONTROL_HZ)
    SIM_LATENCY_MS = cfg.get("sim_latency_ms", SIM_LATENCY_MS)
    assert CONTROL_HZ is not None, "control_hz must be set in deploy-config.json"

    period_s   = 1.0 / CONTROL_HZ
    latencies  = []

    print(f"Warming up ({N_WARMUP} iterations)...")
    for _ in range(N_WARMUP):
        obs = get_current_obs()
        call_policy(obs)
        time.sleep(period_s)

    print(f"Measuring ({N_SAMPLES} iterations)...")
    for i in range(N_SAMPLES):
        obs = get_current_obs()
        t0  = time.perf_counter()
        _   = call_policy(obs)
        t1  = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)   # ms
        time.sleep(max(0.0, period_s - (t1 - t0)))

    lat = np.array(latencies)
    results = {
        "n_samples"          : N_SAMPLES,
        "control_hz"         : CONTROL_HZ,
        "sim_latency_ms"     : SIM_LATENCY_MS,
        "latencies_ms"       : lat.tolist(),
        "mean_ms"            : float(lat.mean()),
        "std_ms"             : float(lat.std()),
        "p50_ms"             : float(np.percentile(lat, 50)),
        "p95_ms"             : float(np.percentile(lat, 95)),
        "p99_ms"             : float(np.percentile(lat, 99)),
        "max_ms"             : float(lat.max()),
    }

    with open("results.json", "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nLatency  mean={results['mean_ms']:.2f}ms  "
          f"p50={results['p50_ms']:.2f}ms  "
          f"p95={results['p95_ms']:.2f}ms  "
          f"p99={results['p99_ms']:.2f}ms")
    if SIM_LATENCY_MS:
        gap = results["p99_ms"] - SIM_LATENCY_MS
        print(f"Sim model={SIM_LATENCY_MS}ms  gap(p99-sim)={gap:+.2f}ms")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="../../deploy-config.json")
    args = ap.parse_args()
    main(args.config)
