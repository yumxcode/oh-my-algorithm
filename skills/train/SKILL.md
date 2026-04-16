# Skill: $train

**Purpose**: Launch a robot RL training run on Gradmotion via `gm` CLI, monitor logs for RL-specific failure modes, collect metric results, and handle failures — including routing code bugs back to `$implement`.

**Read first**: `skills/gradmotion/SKILL.md` — all `gm` command details, field rules, and safety constraints live there. This file covers only the OMA-specific workflow on top of gm.

**Gate in**: `.oma/impl/impl-checklist.md` all `✓` AND `.oma/impl/github.json` exists (code pushed).
**Standalone entry**: Allowed via `oma go train`. If `github.json` is missing, ask for: repoUrl, branch, commitHash, and entry point command.
**Gate out**: `.oma/experiments/{exp-id}/results.json` written with `phase: train`. Gate to `$tune` opens after at least one successful train run.

---

## Session Resumption Check (run FIRST, before anything else)

**Before any new action, check for in-progress work from a previous session:**

1. Read `.oma/trajectory.jsonl` — find any event with `"event":"started"` that has no matching `"event":"completed"` or `"event":"failed"` for the same `expId`.
2. For each orphaned entry, run:
   ```bash
   gm task info --task-id "{taskId}"
   ```
3. Based on the task status:
   - **Running / Queued**: attach to its logs immediately — `gm task logs --task-id "{taskId}" --follow --raw --no-request-log` — and resume from Phase 4.
   - **Completed**: collect results (Phase 5) and write `results.json`. Update trajectory.
   - **Failed**: save error log (Bug-Fix Loop entry), write failed `results.json`. Update trajectory.
   - **Not found / unknown**: log as `"event":"lost"` in trajectory and proceed to launch a new run.

If no orphaned tasks found → proceed to Pre-flight Checklist below.

---

## Pre-flight Checklist

Before creating any task, run these three checks. If any fail, stop and fix before continuing.

```bash
gm --help                  # confirm gm is installed
gm auth status             # confirm local auth token exists
gm auth whoami             # confirm server reachability and identity
```

If `gm auth whoami` fails: prompt the user to run `gm auth login --api-key "<KEY>"` and `gm config set base_url "..."`.

If `.oma/impl/github.json` is missing or has no `commitHash`: `$implement` has not finished — go back and complete it first.

---

## Phase 0 — Context Loading

| File | Required | What to extract |
|------|----------|-----------------|
| `.oma/requirements.md` | ✓ | Primary metric, N seeds, compute constraints |
| `.oma/designs/design-{id}.md` | ✓ | Entry point path, config path, start script |
| `.oma/impl/github.json` | ✓ | `repoUrl`, `branch`, `commitHash`, `designId` |
| `.oma/config.json` | ✓ | `gradmotion.projectId/goodsId/imageId/imageVersion` |
| `.oma/memory.md` | if exists | Dead Ends — do not repeat failed configs |

**If `config.json` is missing Gradmotion fields**, query and ask the user once:

```bash
gm project list --page 1 --limit 50                           # pick projectId
gm task resource list --goods-back-category 3 --page-num 1 --page-size 20   # pick goodsId
gm task image official                                         # pick imageId
gm task image versions --image-id "{imageId}"                 # pick imageVersion (use `id` field, NOT `versionCode`)
```

Write the chosen values into `.oma/config.json` under `"gradmotion": { ... }` for reuse in future runs.

---

## Phase 1 — Verify Resources

Confirm configured IDs are still valid:

```bash
gm task resource list --goods-back-category 3 --page-num 1 --page-size 20
gm task image versions --image-id "{imageId}"
gm project info --project-id "{projectId}"
```

If any check fails, update `.oma/config.json` and re-verify before proceeding.

---

## Phase 2 — Generate Experiment ID and Task Config

Generate a new experiment ID: `exp-{YYYYMMDD}-{3-digit-seq}` (scan `.oma/experiments/` to find next seq).

Create `.oma/experiments/{exp-id}/` directory.

Write `.oma/experiments/{exp-id}/config.json` immediately (crash-recoverable):

```json
{
  "expId": "{exp-id}",
  "designId": "{design-id}",
  "repoUrl": "{repoUrl}",
  "branch": "{branch}",
  "commitHash": "{commitHash}",
  "phase": "train",
  "startedAt": "{ISO timestamp}",
  "gmTaskId": null
}
```

Build the task creation payload and write it to `.oma/experiments/{exp-id}/create-train.json`:

```json
{
  "taskBaseInfo": {
    "projectId": "{gradmotion.projectId}",
    "taskType": "1",
    "trainType": "1",
    "taskName": "{design-id}-{exp-id}",
    "taskDescription": "OMA | design: {design-id} | commit: {7-char hash}",
    "taskTag": ["oma", "{design-id}"],
    "goodsId": "{gradmotion.goodsId}",
    "imageId": "{gradmotion.imageId}",
    "imageVersion": "{gradmotion.imageVersion}",
    "personalDataPath": "/personal"
  },
  "taskCodeInfo": {
    "codeType": "2",
    "codeUrl": "[{\"codeUrl\":\"{repoUrl}\",\"versionType\":\"1\",\"versionName\":\"{branch}\"}]",
    "mainCodeUri": "{entry point path from design, e.g. train.py}",
    "hparamsPath": "{config path from design, e.g. configs/base.json}",
    "startScript": "{start command from design, e.g. python train.py}",
    "isOpen": "1"
  },
  "runtimeReminderConfig": {
    "enableRuntimeReminder": false,
    "reminderDurations": []
  }
}
```

If the GitHub repo is **private**: remind the user that Gradmotion needs their GitHub credentials configured at Web UI → 个人设置 → Git 信息 before the task can pull code.

---

## Phase 3 — Create and Run

```bash
gm task create --file .oma/experiments/{exp-id}/create-train.json
```

Extract `taskId` from the response. Update `gmTaskId` in `.oma/experiments/{exp-id}/config.json`.

```bash
gm task run --task-id "{taskId}"
```

Append to `.oma/trajectory.jsonl`:
```json
{"ts":"{ISO}","phase":"train","expId":"{exp-id}","gmTaskId":"{taskId}","event":"started","commitHash":"{7-char hash}"}
```

**Delete `create-train.json` now** (per gradmotion skill safety rules — no temp files left behind).

---

## Phase 4 — Monitor Logs

```bash
gm task logs --task-id "{taskId}" --follow --interval 2s --no-request-log --raw
```

Classify any failure as soon as it appears. **Robot RL has additional failure modes beyond normal supervised training:**

| Log pattern | Class | Action |
|-------------|-------|--------|
| `Traceback`, `Error:`, `Exception` | **code_bug** | → Bug-Fix Loop |
| `CUDA out of memory`, `OOM` | **oom** | → Bug-Fix Loop (reduce batch or upgrade goods) |
| `ModuleNotFoundError`, `ImportError` | **env_bug** | → Fix: check `imageVersion`, may need different image |
| `FileNotFoundError` on data/config | **config_bug** | → Fix: correct path in config, push, re-run |
| `nan`, `inf` in loss or observations | **nan_explosion** | → RL-specific fix (see below) |
| Reward increases fast then plateaus at unrealistic value | **reward_hacking** | → RL-specific fix (see below) |
| Episode length collapses to minimum within first 50 epochs | **exploration_collapse** | → RL-specific fix (see below) |
| Reward stays flat or decreases for >100 epochs | **no_learning** | → RL-specific fix (see below) |
| Clean exit, metric lines throughout | **success** | → Phase 5 |

**RL-Specific Failure Fixes:**

**nan_explosion** (most common in robot RL):
1. Check observation normalization — unbounded obs → tanh or running mean/std normalization
2. Check reward scale — if reward >> 10, reduce coefficients by 10×
3. Check action scale — large actions → joint limits exceeded → physics instability
4. Reduce learning rate by 5×
5. Add gradient clipping: `max_grad_norm=0.5`
6. Reduce physics timestep (smaller dt = more stable sim)

**reward_hacking** (silent failure — policy found a loophole):
1. Print episode trajectory to logs — look for physically implausible states (joint at limit, body airborne)
2. Identify which reward component is exploited (usually: locomotion reward without survival penalty)
3. Add missing penalty or constraint, push fix via Bug-Fix Loop
4. Do NOT reduce learning rate — this is a reward design bug, not an optimization bug

**exploration_collapse** (policy falls into local optimum immediately):
1. Check entropy coefficient — if too low, increase by 5×
2. Check initial action std — if deterministic init, add noise
3. Check episode reset — if reset to same state every time, add randomization
4. Consider curriculum: start with very easy task variant

**no_learning** (reward flat from start):
1. Verify reward is non-zero in first episode by adding `print(reward)` to env
2. Check observation includes velocity command — policy needs to know what it's supposed to do
3. Check episode length — if too short, policy never receives meaningful feedback
4. Check action clipping — if action space maps to zero-to-tiny joint movement, policy has no effect

After clean exit, confirm status:
```bash
gm task info --task-id "{taskId}"
```

---

## Phase 5 — Collect Results

```bash
gm task data keys --task-id "{taskId}"

gm task data get \
  --task-id "{taskId}" \
  --data-key "{primary metric key from requirements.md}" \
  --sampling-mode "precise" \
  --end-time "{YYYY-MM-DD HH:mm:ss}"
```

Write `.oma/experiments/{exp-id}/results.json`:

```json
{
  "expId": "{exp-id}",
  "gmTaskId": "{taskId}",
  "phase": "train",
  "designId": "{design-id}",
  "commitHash": "{commitHash}",
  "status": "success",
  "metrics": {
    "{primary_metric}": {
      "final": {final value},
      "best":  {best value seen}
    }
  },
  "completedAt": "{ISO timestamp}"
}
```

Append to `.oma/trajectory.jsonl`:
```json
{"ts":"{ISO}","phase":"train","expId":"{exp-id}","gmTaskId":"{taskId}","event":"completed","metric":"{name}","value":{final value}}
```

Report:
```
Train complete.
  Task:    {taskId}  ({taskName})
  Exp:     {exp-id}
  Commit:  {7-char hash} @ {branch}
  {primary_metric}: {final}  (best: {best})
  Gate to $tune is now open.
```

---

## Bug-Fix Loop

**Step 1 — Save the error**

```bash
gm task logs --task-id "{taskId}" --raw --no-request-log > .oma/experiments/{exp-id}/error.log
```

Write `.oma/experiments/{exp-id}/results.json` with `"status": "failed"` and `"errorClass": "{class}"`.

Append to trajectory:
```json
{"ts":"{ISO}","phase":"train","expId":"{exp-id}","gmTaskId":"{taskId}","event":"failed","errorClass":"{class}","summary":"{one line}"}
```

**Step 2 — Fix and re-launch**

Announce the failure class and hand off to `$implement` (Bug-Fix Re-entry section).

After the fix is pushed, re-enter `$train` Phase 2 with a new exp-id. Reuse the failed task's config via `gm task copy`:

Write `.oma/experiments/{new-exp-id}/copy-train.json` (delete after use):
```json
{
  "taskId": "{failed taskId}",
  "projectId": "{projectId}",
  "taskName": "{design-id}-{new-exp-id}",
  "taskDescription": "OMA re-run | fix for {failed exp-id} | commit: {new 7-char hash}"
}
```

```bash
gm task copy --file .oma/experiments/{new-exp-id}/copy-train.json
```

If the code branch/commit changed: run `gm task edit` on the copied task (先读后改 — read full task info first, then merge changes to `codeUrl`, then submit complete JSON).

Then `gm task run --task-id "{new taskId}"` and back to Phase 4.

**OOM special handling**:
- First attempt: reduce batch size in the config file, push, copy task, re-run.
- If OOM persists: suggest the user select a larger `goodsId` from `gm task resource list --goods-back-category 3` and update `.oma/config.json`.

---

## Resume Training (from checkpoint)

To continue a previous run from a checkpoint:

```bash
# List available checkpoints
gm task model list --task-id "{source taskId}" --page-num 1 --page-size 20
```

Use the `policUrl` field from the desired checkpoint as `checkPointFilePath` in the resume JSON (see resume template in `skills/gradmotion/SKILL.md`).

Create a new exp-id for the resume run. Only call `gm task run` if the user explicitly confirms.

---

## Standalone Entry Protocol

If `.oma/standalone.json` exists when this skill is loaded:

```
⚠️ STANDALONE MODE — entering $train directly.
```

**Missing `impl/github.json`**: Ask the user for these 4 fields inline:
> "To launch training I need: (1) GitHub repo URL, (2) branch name, (3) commit hash (or 'latest'), (4) entry point command (e.g. `python train.py --config configs/base.yaml`). Please provide them."

Then write a minimal `.oma/impl/github.json` from their answer and proceed with Phase 2 onward.

**Missing `config.json` Gradmotion fields**: Follow the normal Phase 0 query pattern (`gm project list`, `gm task resource list`, etc.) — this works the same in standalone mode.

**Missing `requirements.md`**: Assume N=3 seeds and ask for primary metric name only.

**Missing `designs/*.md`**: Ask for entry point path and config path inline. Skip design-id field in exp config (`"designId": "standalone"`).
