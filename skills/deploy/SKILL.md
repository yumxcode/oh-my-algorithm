# Skill: $deploy

**Purpose**: Sim2Real validation and iterative hardware deployment for robot locomotion algorithms. This skill does NOT simply package a model — it drives a structured test campaign on real hardware, generates per-test measurement and analysis code, interprets results, and closes the loop back to `$design`.

The output is a `design-feedback.md` that contains concrete, evidence-backed hypotheses for the next design iteration — as important as any passing test.

**Gate in**: `.oma/best.json` with `deployGateOpen: true`.
**Standalone entry**: Allowed via `oma go deploy`. If `best.json` is missing, ask: "Which checkpoint are you deploying? Provide: (1) checkpoint path or URL, (2) robot model, (3) control_hz, (4) did it pass sim evaluation?" Then proceed — the deploy gate warning is shown but not blocking.
**Gate out**: `deploy/deploy-checklist.md` with all mandatory items `✓`.
**Experience library**: A global experience library may exist at `~/.oma/experiences.jsonl` with sim2real findings from past projects (known gap ranges, Kp/Kd adjustment patterns, test-category-specific issues, etc.). If querying it would help, run: `oma xp search "<topic>" --stage deploy`. This is optional — use your judgment.

---

## The Sim2Real Loop

```
$deploy ─── Phase 1: Identify sim2real gaps (from design + results)
              ↓
            Phase 2: Generate test plan (which tests, what order)
              ↓
            Phase 3: Generate test code (measure + analyze per test)
              ↓
            Phase 4: Execute on hardware (safety-first)
              ↓
            Phase 5: Analyze results (quantify gaps, classify failures)
              ↓
            Phase 6: Design feedback (hypotheses for next $design)
              ↓
            Phase 7: Deployment decision
                ├── Gap acceptable → package + deploy
                └── Gap too large → feed back to $design and exit $deploy
```

---

## Phase 0 — Context Loading

| File | Required | What to extract |
|------|----------|-----------------|
| `.oma/best.json` | ✓ | `expId`, checkpoint paths, `deployGateOpen` |
| `.oma/requirements.md` | ✓ | Task type, action/obs space, target hardware, real-world success criteria |
| `.oma/designs/design-{id}.md` | ✓ | Architecture, domain randomization ranges, sim parameters used |
| `.oma/memory.md` | ✓ | Past sim2real failure modes (Dead Ends section) |
| `experiments/{exp-id}/eval-results.json` | ✓ | Sim test metrics — the baseline to compare against |

From `requirements.md` and `design-{id}.md`, extract the **sim parameters** used during training:
- Motor Kp/Kd ranges
- Observation noise std
- Latency / delay modelling
- Friction, inertia, mass randomization ranges
- Contact model settings

These define the sim2real gap hypotheses.

---

## Phase 1 — Sim2Real Gap Analysis

Before writing any test code, analyse the design to predict where gaps are most likely.

For each category below, assess: **simulated range vs real-world typical range**.
Write findings to `deploy/sim2real-gap.md`:

```markdown
# Sim2Real Gap Analysis
_Design: {design-id} | Date: {date}_

## Algorithm Profile
- Policy type: {e.g. MLP, Transformer, CNN}
- Obs space: {list key observations}
- Action space: {joint torques / positions / velocities}
- Control frequency: {Hz}

## Gap Assessment Table

| Category | Sim Setting | Real-World Typical | Gap Risk | Priority |
|----------|------------|-------------------|----------|----------|
| **Latency** | {modelled delay: Xms} | {expected: Y–Zms} | High/Med/Low | 1 |
| **Motor Kp/Kd** | {Kp=X, Kd=Y} | {hardware varies ±N%} | ... | ... |
| **Sensor noise** | {IMU σ=X, enc σ=Y} | {real noise spectrum} | ... | ... |
| **Actuator dynamics** | {first-order model / rigid} | {backlash, friction} | ... | ... |
| **Gait / contact** | {contact model} | {real foot slip, bounce} | ... | ... |
| **Mass / inertia** | {randomization range} | {real ± tolerance} | ... | ... |
| **Terrain** | {flat / perturbed} | {deployment surface} | ... | ... |

## Predicted Failure Modes
1. {Most likely failure — e.g. "policy oscillates due to unmodelled latency"}
2. {Second most likely — e.g. "gait breaks on hard floor due to friction mismatch"}

## Test Priority Order
Based on gap risk × likelihood: {ordered list of test categories}
```

---

## Phase 2 — Test Plan

Select tests from the catalogue below based on Phase 1 priorities. Not all tests are mandatory — choose based on gap risk.

Write `deploy/test-plan.md`:

```markdown
# Deployment Test Plan
_Algorithm: {design-id} | Hardware: {robot model}_

## Safety Prerequisites (always run first)
- [ ] E-stop tested and responsive
- [ ] Joint limit protection active
- [ ] Fall detection active
- [ ] Operator ready to intervene

## Test Sequence

| # | Test | Purpose | Pass Criterion | Est. Duration |
|---|------|---------|---------------|---------------|
| 01 | Latency measurement | Quantify obs→action delay | p99 < {X}ms | 10 min |
| 02 | Motor characterization | Measure actual Kp/Kd | Within ±{N}% of sim | 20 min |
| 03 | Noise characterization | Measure real sensor noise | Noise model validity | 15 min |
| 04 | Standing stability | Basic balance | Stable for {T}s | 10 min |
| 05 | Gait cycle analysis | Foot contact timing, stride | Within {%} of sim | 30 min |
| 06 | Speed range | Min/max stable speed | Matches requirements | 20 min |
| 07 | Disturbance rejection | Push test | Recovers within {T}s | 15 min |
| 08 | Terrain generalization | Different surfaces | {list criteria} | 30 min |

## Stop Conditions
Stop ALL testing immediately if:
- Any joint exceeds {limit} for more than {T}ms
- Robot falls and recovery is not automatic within {T}s
- IMU reads angular velocity > {threshold}
- Operator calls e-stop
```

---

## Phase 3 — Generate Test Code

For each test in the plan, generate two scripts and place them in `deploy/tests/{NN}-{name}/`:

1. `measure.py` — data collection (runs on the robot or alongside it)
2. `analyze.py` — offline analysis of collected data

Generate scripts by reading the algorithm's obs/action space from `design-{id}.md` and `experiments/{exp-id}/config.json`. Do NOT write generic placeholders — fill in the actual joint names, topic names, control frequency, and obs dimensions.

### Test Code Templates

---

#### Test 01: Latency Measurement

`measure.py` — instrument the policy inference loop:
```python
# deploy/tests/01-latency/measure.py
"""Measure obs→action end-to-end latency.
Run alongside policy node. Injects obs, timestamps action arrival."""
import time, json, numpy as np

CONTROL_HZ = {control_freq}   # from design
N_SAMPLES   = 1000

latencies = []
for _ in range(N_SAMPLES):
    obs = get_current_obs()       # implement per robot API
    t0  = time.perf_counter()
    act = policy.infer(obs)       # synchronous call
    t1  = time.perf_counter()
    latencies.append((t1 - t0) * 1000)  # ms
    time.sleep(1.0 / CONTROL_HZ)

results = {
    "latencies_ms": latencies,
    "p50": float(np.percentile(latencies, 50)),
    "p95": float(np.percentile(latencies, 95)),
    "p99": float(np.percentile(latencies, 99)),
    "mean": float(np.mean(latencies)),
    "std":  float(np.std(latencies)),
}
json.dump(results, open("results.json", "w"), indent=2)
print(f"Latency p50/p95/p99: {results['p50']:.1f}/{results['p95']:.1f}/{results['p99']:.1f} ms")
```

`analyze.py` — compare against sim modelled delay:
```python
# deploy/tests/01-latency/analyze.py
import json, numpy as np, matplotlib.pyplot as plt

r = json.load(open("results.json"))
SIM_MODELLED_DELAY_MS = {sim_latency}  # from design

gaps = {
    "p99_gap_ms": r["p99"] - SIM_MODELLED_DELAY_MS,
    "exceeds_sim_model": r["p99"] > SIM_MODELLED_DELAY_MS,
}
# Plot histogram, write report.md
```

---

#### Test 02: Motor Characterization (Kp/Kd Identification)

`measure.py` — step response per joint:
```python
# deploy/tests/02-motor-char/measure.py
"""Apply step position commands per joint, record actual trajectory.
Fit first-order + PD model to identify effective Kp, Kd, friction."""
import numpy as np, json

JOINTS     = {joint_names}   # from design obs space
STEP_DELTA = 0.05            # radians — small enough to be safe
RECORD_HZ  = {control_freq}
DURATION_S = 2.0

results = {}
for joint in JOINTS:
    # Hold all other joints at current position
    # Apply step command to this joint
    # Record position, velocity, torque at RECORD_HZ
    trajectory = record_step_response(joint, STEP_DELTA, DURATION_S)
    kp_est, kd_est, friction_est = fit_pd_model(trajectory)
    results[joint] = {
        "kp_estimated": kp_est,
        "kd_estimated": kd_est,
        "friction_estimated": friction_est,
        "kp_sim": {sim_kp},       # from design
        "kd_sim": {sim_kd},
        "kp_error_pct": abs(kp_est - {sim_kp}) / {sim_kp} * 100,
    }

json.dump(results, open("results.json", "w"), indent=2)
```

`analyze.py` — flag joints with >10% deviation, generate domain randomization recommendations.

---

#### Test 03: Sensor Noise Characterization

`measure.py` — record sensor streams while robot is stationary:
```python
# deploy/tests/03-noise/measure.py
"""Record IMU, joint encoders at {control_freq}Hz for 60s while stationary.
Compute noise PSD and compare against sim noise model."""
SENSORS = {
    "imu_accel": {"channels": 3, "sim_std": {imu_accel_noise}},
    "imu_gyro":  {"channels": 3, "sim_std": {imu_gyro_noise}},
    "joint_pos": {"channels": {n_joints}, "sim_std": {joint_pos_noise}},
    "joint_vel": {"channels": {n_joints}, "sim_std": {joint_vel_noise}},
}
# Record 60s at control frequency, compute std per channel
```

`analyze.py` — compare real noise std vs sim noise std per sensor, flag under-modelled sensors.

---

#### Test 04: Standing Stability

`measure.py` — deploy policy in standing mode, record for 60s:
```python
# deploy/tests/04-stability/measure.py
"""Run policy in standing mode. Record:
- CoM height drift
- Foot contact distribution
- Joint torque RMS
- Angular velocity (stability proxy)"""
METRICS_HZ  = 100
DURATION_S  = 60
```

`analyze.py` — compute stability score, compare joint torque RMS vs sim baseline.

---

#### Test 05: Gait Cycle Analysis

`measure.py` — record during forward walking at nominal speed:
```python
# deploy/tests/05-gait/measure.py
"""Walk forward at {nominal_speed}m/s for 10 strides. Record:
- Foot contact events (touch-down / lift-off timestamps)
- Stride length, step height
- Duty cycle per leg
- CoM velocity (from base IMU + leg odometry)"""
TARGET_SPEED   = {nominal_speed}   # m/s from requirements
STRIDE_N       = 10
```

`analyze.py`:
```python
# Compare against sim gait statistics:
SIM_STRIDE_LENGTH = {sim_stride}   # m
SIM_DUTY_CYCLE    = {sim_duty}     # fraction
SIM_STEP_HEIGHT   = {sim_step_h}   # m

# Compute: actual vs sim per metric, flag deviations > 15%
# Report: gait regularity score (variance across strides)
```

---

#### Test 06: Speed Range

`measure.py` — sweep commanded speeds from min to max:
```python
# deploy/tests/06-speed/measure.py
SPEED_RANGE = np.linspace({min_speed}, {max_speed}, num=8)  # from requirements
# Per speed: walk 5m, measure actual speed, stability, energy
```

---

#### Test 07: Disturbance Rejection

`measure.py` — record recovery from lateral push:
```python
# deploy/tests/07-disturbance/measure.py
"""Operator applies lateral push at shoulder height (~10N).
Record recovery trajectory: time to stable, max tilt angle."""
# Each push trial: trigger recording → push → wait 3s → stop
```

---

#### Test 08: Terrain Generalization

`measure.py` — walk on different surfaces (tile, carpet, grass, slight slope):
```python
# deploy/tests/08-terrain/measure.py
TERRAINS = ["tile", "carpet", "grass", "slope_3deg", "slope_5deg"]
# Per terrain: 5m walk, record slip events, gait quality, falls
```

---

## Phase 4 — Test Execution

Execute tests in plan order. For each test:

1. Brief the operator on the test procedure and stop conditions
2. Confirm safety prerequisites (Phase 2 checklist) before each test
3. Run `measure.py` — save raw data to `deploy/tests/{NN}-{name}/raw/`
4. Run `analyze.py` — produce `deploy/tests/{NN}-{name}/results.json` and `report.md`
5. Record pass/fail against plan criteria

**Between tests**: Check for unexpected hardware wear (motor temperature, joint health).

**If a test causes a fall or safety event**: Stop all testing. Document the failure in `deploy/tests/{NN}-{name}/incident.md` with: conditions, what happened, recovery. This is valuable data for design feedback.

---

## Phase 5 — Results Analysis

After all tests complete (or after stopping for safety), synthesise findings.

Write `deploy/results-summary.md`:

```markdown
# Deployment Test Results
_Algorithm: {design-id} | Date: {date} | Hardware: {robot}_

## Test Outcomes

| Test | Result | Key Metric | vs Sim | Gap | Action |
|------|--------|-----------|--------|-----|--------|
| 01 Latency | ✓ PASS | p99={X}ms | sim={Y}ms | +{Z}ms | None |
| 02 Motor Kp/Kd | ✗ FAIL | max err=18% | target<10% | 8pp | Expand DR |
| 03 Noise | ✓ PASS | all sensors within 1.5× sim | — | — | None |
| 04 Stability | ✓ PASS | stable 60s | sim stable | — | None |
| 05 Gait | △ WARN | duty cycle {X}% vs sim {Y}% | -{Z}% | 12% | Monitor |
| 06 Speed range | ✓ PASS | {min}–{max} m/s | matches | — | None |
| 07 Disturbance | ✗ FAIL | recovery={X}s | sim={Y}s | +{Z}s | Retrain |
| 08 Terrain | △ WARN | slip on grass | no sim DR | — | Add terrain DR |

## Overall Sim2Real Gap Score
{computed as: (passed tests) / (total tests) × weight by priority}

## Critical Failures
{List any falls, safety events, or hard FAILs with root-cause hypothesis}
```

---

## Phase 6 — Design Feedback

This is the most important output of `$deploy`. Convert every test result into a concrete, testable hypothesis for the next `$design` iteration.

Write `deploy/design-feedback.md`:

```markdown
# Design Feedback for Next Iteration
_Source: deployment test {date} | Algorithm: {design-id}_

## Critical (must fix before re-deployment)

### FB-01: Latency margin too thin
- **Evidence**: p99 latency = {X}ms, sim modelled only {Y}ms
- **Root cause hypothesis**: Policy inference is {Z}ms; remaining {W}ms is communication overhead not modelled in sim
- **Recommended $design change**:
  - Option A: Reduce policy network size (distil to smaller MLP)
  - Option B: Increase simulated latency in DR range to [{Y}–{X+5}]ms
  - Option C: Move policy to onboard GPU (hardware change)
- **Expected gain**: Closing this gap should recover {est. metric improvement}

### FB-02: Motor Kp/Kd mismatch causing oscillation
- **Evidence**: joint {name} Kp measured at {X}, sim assumed {Y} (error {Z}%)
- **Root cause hypothesis**: Sim used fixed Kp/Kd; real motors have temperature-dependent gain
- **Recommended $design change**:
  - Widen Kp DR range from [{a,b}] to [{c,d}] (cover measured range + 20% margin)
  - Add Kd randomization (currently fixed in sim)
  - Consider adding Kp/Kd as part of the privileged critic input
- **Priority**: HIGH (oscillation is a stability risk)

## Important (fix in next 1–2 iterations)

### FB-03: Disturbance recovery slower than sim
- **Evidence**: push recovery {X}s real vs {Y}s sim
- **Root cause hypothesis**: Sim contact model too forgiving; real floor has higher friction causing different recovery dynamics
- **Recommended $design change**:
  - Add friction randomization: μ ~ Uniform({a}, {b}) (currently {c})
  - Add push perturbation in training: F_push ~ Uniform(5N, 15N) at random body sites
- **Priority**: MEDIUM

## Observations (inform but not blocking)

### FB-04: Gait duty cycle shifted on carpet
- **Evidence**: duty cycle {real}% vs sim {sim}% — within acceptable range but trending
- **Root cause hypothesis**: Carpet friction damps foot bounce; sim contact bounces more
- **Recommended $design change**:
  - No immediate change needed. Monitor across 2 more deployments.
  - If trend continues: add terrain texture DR

## Summary Priority Queue for $design

| Priority | Feedback | Design Change Type | Estimated Impact |
|----------|---------|-------------------|-----------------|
| 1 | FB-02: Motor Kp/Kd | Widen DR range | High — stability |
| 2 | FB-03: Disturbance | Add push perturbation | Medium — robustness |
| 3 | FB-01: Latency | Network distillation | Medium — reliability |
| 4 | FB-04: Gait drift | Terrain DR | Low — future-proofing |
```

---

## Phase 7 — Deployment Decision

Based on the results summary, make one of three decisions:

**DEPLOY**: All critical tests pass. Acceptable gaps documented. Package and deploy.
- Package the policy: serialize model, write `deploy/serve.py`, pin `deploy/requirements.txt`
- Write minimal deployment config: control frequency, obs/action space, safety thresholds
- Complete `deploy/deploy-checklist.md`

**HOLD — fix hardware/config**: Tests failed due to hardware configuration (wrong Kp/Kd loaded, firmware issue). Fix config, re-run affected tests only. No `$design` change needed.

**RETURN TO $design**: Critical sim2real gaps found that cannot be fixed by config change.
- Write the decision in `deploy/deploy-checklist.md` with reason
- Hand `deploy/design-feedback.md` to the next `$design` session
- Announce: "Returning to $design with {N} critical findings. See deploy/design-feedback.md."

---

## deploy/deploy-checklist.md

```markdown
# Deployment Checklist
_Algorithm: {design-id} | Date: {date} | Hardware: {robot}_

## Safety
- [ ] E-stop tested before all sessions
- [ ] No joint limit violations during any test
- [ ] No uncontrolled falls during tests (or all incidents documented)

## Tests Completed
- [ ] 01 Latency: {result}
- [ ] 02 Motor Kp/Kd: {result}
- [ ] 03 Noise: {result}
- [ ] 04 Stability: {result}
- [ ] 05 Gait cycle: {result}
- [ ] 06 Speed range: {result}
- [ ] 07 Disturbance: {result}
- [ ] 08 Terrain: {result}

## Outputs
- [ ] deploy/sim2real-gap.md written
- [ ] deploy/results-summary.md written
- [ ] deploy/design-feedback.md written (mandatory regardless of outcome)

## Decision
- [ ] **DEPLOY** — all critical tests passed, model packaged at `deploy/model.{ext}`
- [ ] **HOLD** — config/hardware fix required, re-test scheduled
- [ ] **RETURN TO $design** — critical sim2real gaps, feedback written

## Known Limitations in Deployment
{list any remaining gaps that are accepted as known limitations}
```

---

## Completion Signal

```
Deploy complete.
  Algorithm:  {design-id}
  Hardware:   {robot}
  Tests:      {N passed} / {total} — {N critical failures}
  Decision:   {DEPLOY / HOLD / RETURN TO $design}
  Sim2Real gap score: {X}/{total} tests passed
  Design feedback: {N} recommendations written to deploy/design-feedback.md
  {If DEPLOY: Model packaged at deploy/model.{ext}}
  {If RETURN: Next $design priority: {top FB item}}
```
