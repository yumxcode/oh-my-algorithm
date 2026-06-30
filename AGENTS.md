# oh-my-algorithm (OMA)

OMA 是一套**机器人算法开发工作流编排层**，请严格执行相关流程。
技能文件位于 `.oma/skills/*/SKILL.md`，是各阶段的执行规范；本文件仅作路由合约。

**核心风险**：sim-to-real gap 是每个阶段的首要风险。Reward hacking 是静默失败——高奖励若缺乏物理可信度即为死路。切勿仅凭仿真结果断言策略有效。

---

## STARTUP PROTOCOL (run before any action)

1. `.oma/standalone.json` exists? → **Standalone Mode** (gates advisory only).
2. Read `.oma/memory.md` → internalize Dead Ends. Do not re-explore them.
3. Check gate condition for the requested skill. Blocked gate = stop and report (Normal Mode only).
4. **Cross-session recovery**:
   - `.oma/loop.json` exists → an iteration loop is in progress; read `lap` / `stage` / `exp_id` / `hypothesis` and resume that lap at that stage. This is the primary "where was I" pointer for the design↔implement↔train↔tune loop.
   - `.oma/design-draft.md` exists → `$design` interrupted; resume from Phase 2, skip idea generation.
   - `.oma/tune-current.json` exists → `$tune` in progress; read `phase` field, resume accordingly.
   - Scan `trajectory.jsonl` for `"event":"started"` without matching `"completed"/"failed"` → run `gm task info` on each orphaned task.
5. **Global XP**: `oma xp index --format md` to scan the lightweight index; `oma xp show <id>` only for relevant entries.

---

## Gate Chain (two hard gates + a free iteration loop)

There are **only two hard gates**. Everything between them is a cyclic, data-driven
loop where `$design`, `$implement`, `$train`, `$tune` are **mutually advisory** — move
in any direction (including backward: a `$tune` analysis that motivates a `$design`
change) without tripping a gate.

```
$requirement  →  requirements.md + knowledge.md  (LOCKED)
        │
        ▼   ══ HARD GATE (enter loop): requirements.md LOCKED ══
┌──────────────── ITERATION LOOP  (one lap ≈ one exp_id) ────────────────┐
│                                                                        │
│   $design ──→ $implement ──→ $train ──→ $tune                          │
│      ▲   (delta)   │  (code)    │ (gm)    │ (sweep/analyse)            │
│      │             │            │         │                            │
│      └─────────────┴────────────┴─────────┘  data-driven change        │
│                                                                        │
│   per lap:  hypothesis + change + result + conclusion  (experiment.json)│
│   turnaround:  $train → experiment-analysis → [human confirm]          │
│                       → experiment-recording → next lap                │
│   loop state: .oma/loop.json  { lap, stage, exp_id, hypothesis }       │
│                                                                        │
└────────────────────────────────┬───────────────────────────────────────┘
                                 ▼  ══ HARD GATE (exit loop): best.json deployGateOpen === true ══
                      $deploy →  sim2real gap analysis → test campaign → hardware
                              →  design-feedback.md  ──(re-enters the loop)
```

**Gate semantics**

| Transition | Gate | Type |
|------------|------|------|
| → enter loop (`$design`/`$implement`/`$train`/`$tune`) | `requirements.md` LOCKED | **HARD** |
| within loop (any ↔ any of the four) | none — advisory only | soft |
| loop → `$deploy` | `best.json` `deployGateOpen === true` | **HARD** |

Inside the loop, the agent must NOT block on "previous artifact missing". A `$tune`
that exposes a problem may go straight back to `$design` (delta) or `$implement`
without a fresh full design doc. **First lap** typically produces a full
`design-{id}.md`; **later laps** usually produce only a *delta* — the
`hypothesis` + `change` of the lap's `experiment.json` (archive_level `light`).
Promote to a full design doc only for major changes (reward redesign, architecture
swap) — i.e. archive_level `full`.

---

## Stage I/O Contract  (read before acting in any stage)

Each stage's inputs/outputs, kept here in the always-loaded rule so you do not need to
open the skill to know what a stage reads and must write. The full procedure is in the
named `.oma/skills/<stage>/SKILL.md`; read it when you enter the stage.

| Stage | Reads (input) | Writes / records (output) | Template to read first |
|-------|---------------|---------------------------|------------------------|
| `$requirement` | paper, user interview | `requirements.md`, `knowledge.md` (LOCKED) | `.oma/templates/requirements.md`, `knowledge.md` |
| `$design` | `knowledge.md` (or loop seed) | full `design-{id}.md` (first lap) **or** delta = `experiment.json.hypothesis/change` | `.oma/templates/design.md` |
| `$implement` | current design / lap delta | code + `impl/impl-checklist.md` + `impl/github.json` | — |
| `$train` | pushed code / config | `experiments/{exp_id}/results.json` (`phase: train`), append `trajectory.jsonl` | `.oma/templates/experiment-config.json`, `results.json` |
| `$tune` | ≥1 train result | `leaderboard.json`, `best.json` (`deployGateOpen`) | `.oma/templates/experiment-config.json` |
| `$deploy` | `best.json` gate open | `deploy/` artifacts, `sim2real_checklist.md` | `.oma/templates/deploy-config.json`, `sim2real_checklist_template.md` |
| `$consolidate` | recent experiments | `memory.md` (Dead Ends / Working Patterns) | `.oma/templates/memory.md` |
| `experiment-recording` | a finished run | per-lap `experiment.json` (+ 三件套 for `full`) | `.oma/templates/results.json` |

Every stage also updates `.oma/loop.json` `stage` on entry (and `lap`/`exp_id` when a new lap starts).

## Recording Discipline  (lap checkpoints — soft, agent-proposed)

The loop's memory is only as good as what gets recorded. As a standing rule:

1. **At each lap close** — when `$train` or `$tune` produces a result — the agent must
   **proactively propose recording** (do not wait to be asked): "本圈 (exp `{exp_id}`) 跑完了，
   是否记录？archive_level 建议 `light`/`full`。" Proceed to `experiment-recording` on the
   user's OK. This is advisory: the agent proposes, the human confirms.
2. **What a checkpoint captures**: the lap's `hypothesis`, `change`, `result`, `conclusion`
   (the `experiment.json` fields); `full` laps add lineage + notes.
3. **After recording**, update `.oma/loop.json` (`lap`/`stage`/`exp_id`) and append `trajectory.jsonl`.
4. Never let a lap close silently — an unrecorded lap is a lost lesson.

## Templates

Process templates live in `.oma/templates/` (installed by `oma setup`). Before producing a
stage's artifact, **read the matching template** from the Stage I/O table above and follow its
shape. Templates are the canonical structure; do not invent ad-hoc formats.

---

## Keyword → Skill Routing

| Keyword(s) | Skill | Action |
|------------|-------|--------|
| requirement, define problem, clarify, success criteria | `$requirement` | Read `.oma/skills/requirement/SKILL.md`, execute |
| design, architecture, reward design, policy design, network | `$design` | Read `.oma/skills/design/SKILL.md`, execute |
| implement, code it, build pipeline, write trainer | `$implement` | Read `.oma/skills/implement/SKILL.md`, execute |
| index codebase, scan repo, reference implementation | `oma index` | Run `oma index --src <path>` |
| train, run training, launch experiment, start training | `$train` | Read `.oma/skills/train/SKILL.md`, execute |
| tune, sweep, ablation, hyperparameter, evaluate, final eval | `$tune` | Read `.oma/skills/tune/SKILL.md`, execute |
| analyse exp, compare exp, exp CSV, joints, leg symmetry, yaw drift, /compare | `experiment-analysis` | Read `.oma/skills/experiment-analysis/SKILL.md`, execute (tune-stage helper) |
| record exp, archive experiment, write to lab, /update-lab | `experiment-recording` | Read `.oma/skills/experiment-recording/SKILL.md`, execute (tune-stage helper) |
| deploy, sim2real, hardware test, real robot | `$deploy` | Read `.oma/skills/deploy/SKILL.md`, execute |
| consolidate, update memory, record findings | `$consolidate` | Read `.oma/skills/consolidate/SKILL.md`, execute |
| next lap, next exp, iterate, 下一轮, 下一圈, 再改, loop | Iteration loop | Open a new lap: bump `.oma/loop.json` `lap`, set `stage` to the entered skill, allocate the next `exp_id`. Then route into `$design`/`$implement`/`$train`/`$tune` per the request. |
| go \<stage\>, skip to, jump to, just do, standalone | Standalone | Write `.oma/standalone.json`, enter named stage |
| gm, gradmotion, training platform | `$train` | Reads gradmotion skill internally |

Keywords are case-insensitive. Multiple matches → use most specific. Rest of message = task description passed to skill.

Inside the iteration loop, treat `$design`/`$implement`/`$train`/`$tune` requests as
loop moves: keep `.oma/loop.json` `stage` current, do **not** block on a missing
upstream artifact (only `requirements.md` LOCKED is required to be in the loop).

---

## Standalone Mode

**Trigger**: `.oma/standalone.json` exists OR user runs `oma go <stage>`.
Gates become advisory. Show `⚠️ STANDALONE` notice listing missing artifacts, then continue.

```bash
oma go requirement | design | implement | train | tune | deploy
oma go loop [--stage design|implement|train|tune] [--reason "..."]   # enter the loop WITHOUT $requirement
oma go off   # return to gated mode (keeps loop.json)
```

### Entering the loop without `$requirement` (`oma go loop`)

For an existing codebase or a quick iteration where no formal requirement phase
is wanted. It waives the enter-loop hard gate (`requirements.md` LOCKED), creates
`.oma/loop.json` (lap 1, the chosen start stage, a fresh `exp_id`), and drops you
straight into the cyclic `$design ↔ $implement ↔ $train ↔ $tune`. The deploy gate
still applies to exit.

**Minimal seed (the entered skill must capture this on entry — it is NOT blocking):**
even without a requirement doc, the loop needs the bare minimum to rank and to
define the exit gate. On the first loop skill invocation, confirm with the user:
- **primary metric** + direction (higher/lower better) → write to `.oma/config.json` `metric_higher_is_better`;
- **robot / sim target**: robot model, sim_env, control_hz (and DOF if relevant).

Ask only for what's missing; if a registered codebase exists (`.oma/codebase/config.json`
via `oma index`), infer what you can from it first and only ask to confirm. Do not
run the full `$requirement` interview.

---

## State Files

| Path | Owner |
|------|-------|
| `.oma/requirements.md` | `$requirement` |
| `.oma/knowledge.md` | `$requirement` |
| `.oma/designs/design-{id}.md` | `$design` |
| `.oma/impl/impl-checklist.md` | `$implement` |
| `.oma/impl/github.json` | `$implement` |
| `.oma/experiments/exp-{id}/` | `$train`, `$tune` |
| `.oma/leaderboard.json` | `$tune` |
| `.oma/best.json` | `$tune` Phase 5 only |
| `.oma/trajectory.jsonl` | `$train`, `$tune` (append-only) |
| `.oma/memory.md` | `$consolidate` only |
| `.oma/loop.json` | iteration loop pointer — upserted by `$design`/`$implement`/`$train`/`$tune` on entry |
| `.oma/standalone.json` | `oma go` |
| `deploy/` | `$deploy` |

### `.oma/loop.json` schema

The lightweight "where am I in the loop" pointer. Any inner-loop skill upserts it on
entry (same spirit as `design-draft.md` / `tune-current.json`). Read it at startup.

```json
{
  "lap": 3,
  "stage": "tune",                       // design | implement | train | tune
  "exp_id": "exp-20260630-002",          // the exp_id this lap is anchored to
  "hypothesis": "raise ankle-torque DR upper bound to cut yaw drift",
  "opened_at": "2026-06-30T09:00:00Z",
  "updated_at": "2026-06-30T11:20:00Z"
}
```

Rules: a **new lap** (`lap`+1) starts when a fresh change is taken into `$design`/`$implement`
after a `$train`/`$tune` round closed (i.e. a new `exp_id`). Moving between stages of the
**same** lap only updates `stage`/`updated_at`. `$deploy` exiting the loop does not delete
`loop.json`; the next loop entry (e.g. after `design-feedback.md`) bumps the lap.
