# Skill: $evaluate

> **DEPRECATED — merged into `$tune`.**
> Final test-set evaluation is now Phase 5 of `$tune`. Read `skills/tune/SKILL.md` instead.
> This file is kept for reference only. Do not execute it directly.

---

**Purpose**: Authoritative, one-time evaluation of a candidate model on the held-out test set. This is the only skill that updates `best.json` and determines whether the gate to `$deploy` opens.

**Gate in**: `.oma/leaderboard.json` must exist with at least one candidate experiment.
**Gate out**: Updates `.oma/best.json` if result improves current best. Appends to `trajectory.jsonl`. **Automatically triggers `$consolidate`.**

⚠️ **The test set is sacred.** It must not have been used in any prior training or tuning step. Verify this before running.

---

## Execution Protocol

### Phase 1 — Pre-flight Checks

Before touching the test set, verify all of the following. If any fails, stop and report.

**Data leakage check:**
- [ ] Test set was defined in requirements.md and has not been loaded during $train or $tune.
- [ ] Preprocessing (normalization stats, vocabulary, tokenizer) was fitted on training data only.
- [ ] If using a public benchmark, confirm the leaderboard version / split being used matches requirements.md.

**Candidate selection:**
- [ ] Read `leaderboard.json`. Select the top-ranked experiment by `metric_mean`.
- [ ] Confirm the candidate's checkpoint file exists and is readable.
- [ ] Confirm N seeds are available for this candidate (re-run if necessary with test-set inference only, not re-training).

**Budget check:**
- [ ] Read requirements.md for compute budget. Evaluate cost is typically low (inference only). Log estimated cost.

---

### Phase 2 — Test Set Evaluation

Run inference on the held-out test set using the candidate model's saved checkpoints.

- Load each seed's checkpoint separately.
- Compute the primary metric (from requirements.md) for each seed.
- Compute all secondary metrics listed in requirements.md.
- Do NOT retrain, fine-tune, or modify the model based on test results.

Produce `eval_results_raw.json` in the candidate experiment directory:

```json
{
  "exp_id": "exp-20250116-001",
  "phase": "evaluate",
  "evaluated_at": "{ISO timestamp}",
  "data_leakage_check": "passed",
  "test_set_version": "{hash or description}",
  "per_seed": [
    {
      "seed": 42,
      "primary_metric": {"name": "f1_macro", "value": 0.851},
      "secondary_metrics": {"precision": 0.847, "recall": 0.855, "auc": 0.921}
    }
  ],
  "summary": {
    "f1_macro": {"mean": 0.849, "std": 0.003},
    "precision": {"mean": 0.845, "std": 0.004},
    "recall": {"mean": 0.853, "std": 0.003},
    "auc": {"mean": 0.919, "std": 0.005}
  }
}
```

---

### Phase 3 — Threshold Comparison

Read requirements.md success criteria table. Compare test results against each threshold.

```markdown
## Threshold Comparison
| Metric | Threshold | Result (mean ± std) | Pass? |
|--------|----------|---------------------|-------|
| f1_macro | ≥ 0.840 | 0.849 ± 0.003 | ✓ PASS |
| inference_latency_ms | ≤ 100ms | 67ms | ✓ PASS |
```

**Gate decision:**
- ALL threshold conditions must pass to open the gate to `$deploy`.
- If any threshold fails: do NOT open deploy gate. Report the gap. Recommend whether to re-enter $tune or revisit $design.

---

### Phase 4 — Update best.json

**Only $evaluate may write to `.oma/best.json`.**

If this evaluation result improves the current best (or no best.json exists):

```json
{
  "exp_id": "exp-20250116-001",
  "evaluated_at": "{ISO timestamp}",
  "primary_metric": {"name": "f1_macro", "mean": 0.849, "std": 0.003},
  "all_thresholds_passed": true,
  "deploy_gate_open": true,
  "checkpoint_paths": {
    "seed_42": "experiments/exp-20250116-001/checkpoints/seed42_best.pt",
    "seed_123": "...",
    "seed_456": "..."
  },
  "config_ref": "experiments/exp-20250116-001/config.json",
  "design_ref": "designs/design-20250115-001.md"
}
```

If this result does NOT improve the current best, update `best.json` only if `all_thresholds_passed` changes from false to true.

---

### Phase 5 — Error Analysis

Write an error analysis section to `experiments/{exp-id}/verdict.md`:

```markdown
## Error Analysis

### Failure Modes
- {Describe the most common error patterns on the test set}
- {Which classes/inputs are most frequently mispredicted?}
- {Is there a systematic bias (e.g. over-predicts majority class)?}

### Robustness Notes
- {How stable are results across seeds (std relative to mean)?}
- {Are there any seeds that are strong outliers?}

### Gap to Stretch Target
- Current: {mean}. Stretch target: {value}. Gap: {delta}.
- Hypothesized blockers: {list}
```

---

### Phase 6 — Append to trajectory.jsonl

```jsonl
{"timestamp":"...","exp_id":"exp-20250116-001","phase":"evaluate","metric_mean":0.849,"metric_std":0.003,"metric_name":"f1_macro","thresholds_passed":true,"deploy_gate_open":true}
```

---

### Phase 7 — Trigger $consolidate

Mandatory. Invoke `$consolidate` with the error analysis and threshold comparison as context.

---

## Completion Signal

The skill is complete when:
1. `eval_results_raw.json` written to experiment directory.
2. Threshold comparison completed and documented.
3. `best.json` updated (if appropriate).
4. `trajectory.jsonl` appended.
5. `$consolidate` invoked.

Report: "Evaluation complete. Test {metric_name}: {mean} ± {std}. Thresholds: {all passed / N failed}. Deploy gate: {open / blocked by: {reason}}."
