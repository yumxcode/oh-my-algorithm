# Design — {PROJECT_NAME}
_ID: design-{YYYYMMDD}-{SEQ}_
_Created: {DATE}_
_Status: DRAFT — becomes LOCKED after $design Phase 4_
_Knowledge source: {knowledge.md paper reference}_

<!--
  USAGE:
  - Written by $design Phase 4.
  - Read by $implement, $tune.
  - LOCKED after $design completes.
  - Each field should record its provenance (Stream A/B/C + source).
-->

## Idea Pool Summary
<!-- Which ideas were generated, evaluated, and why this one was selected -->

| ID | Title | Stream | Priority | Decision |
|----|-------|--------|----------|---------|
| A1 | {title} | A | {score} | {selected / skipped: reason} |
| B1 | {title} | B | {score} | {selected / skipped: reason} |
| C1 | {title} | C | {score} | {selected / skipped: reason} |

**Selected**: {Idea ID} — {one-sentence justification}
**Human input**: {what the human selected/modified/hinted}

---

## Primary Design

### Provenance
- **Core idea**: {Idea ID} [{Stream A/B/C}]
- **Source**: {paper title / limitation text / cross-domain analogy}
- **Human modification**: {description or "none"}

### Problem Statement (from knowledge.md)
- Task: {from knowledge.md — do not paraphrase}
- Primary metric: {metric name and formula}
- Baseline to beat: {value from knowledge.md Evaluation Protocol}

### Architecture
<!-- Concrete layer-by-layer specification. No vague descriptions. -->

**Input preprocessing**
- {step 1: e.g., "normalize features to zero mean, unit variance using training statistics"}
- {step 2}

**Model structure**
```
Layer 1: {type} — input: {shape}, output: {shape}, params: ~{N}
Layer 2: {type} — input: {shape}, output: {shape}, params: ~{N}
...
Output head: {type} — {shape} → {shape}
Total parameters: ~{N}
```

**Design rationale**: {why this architecture — link to provenance}

### Loss Function
- Primary loss: {name} — formula: {LaTeX or plain text}
- Auxiliary losses (if any): {name}, weight: {λ}
- Known failure modes of this loss: {e.g., "sensitive to class imbalance"}

### Optimization
| Hyperparameter | Value | Source |
|---------------|-------|--------|
| Optimizer | {e.g. AdamW} | {from paper / proposed} |
| Learning rate | {value} | {from paper / proposed} |
| LR schedule | {type} | {from paper / proposed} |
| Warmup | {steps or ratio} | {proposed} |
| Batch size | {value} | {from paper / proposed} |
| Gradient clip | {value or "none"} | {proposed} |
| Weight decay | {value} | {proposed} |
| Dropout | {value} | {proposed} |
| Epochs | {value} | {proposed} |

### Reproducibility
- Global seed policy: Python={seed}, NumPy={seed}, {framework}={seed}
- Non-deterministic ops: {list or "none identified"}
- Data loading: worker seeds set to base_seed + worker_id

---

## Ablation Plan
<!-- Each row = one $tune experiment variable -->

| Variable | Candidates | Hypothesis | Priority | Linked to design decision |
|---------|-----------|-----------|---------|--------------------------|
| {e.g. attention_type} | [none, dot-product, additive] | {expected outcome} | high | Layer 2 design |
| {e.g. loss_weight_λ} | [0.1, 0.5, 1.0] | {expected outcome} | medium | Loss function |
| {e.g. warmup_ratio} | [0.0, 0.05, 0.10] | {expected outcome} | low | Optimization |

Sweep strategy for $tune: {sequential ablation / grid / directed}
Estimated configurations: {N} × {seeds} = {total runs}

---

## Alternative Designs (Fallbacks)

### Alternative 1 — {Idea ID}: {Title}
_Use if primary design fails to beat baseline after {N} training runs_

- Core difference from primary: {one sentence}
- Provenance: Stream {X} — {source}
- Expected: {metric estimate}
- Key risk: {what could go wrong}

### Alternative 2 — {Idea ID}: {Title} (optional)
_Use if Alternative 1 also underperforms_

- Core difference: {one sentence}
- Provenance: Stream {X} — {source}

---

## Design Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| {e.g. "overfitting on small dataset"} | medium | {e.g. "strong dropout + early stopping"} |
| {e.g. "training instability at high lr"} | low | {e.g. "warmup + gradient clipping"} |
| {e.g. "cross-domain transfer fails"} | medium | {fallback to Alternative 1} |

---

## Dead Ends Confirmed (do not revisit)
<!-- From knowledge.md Dead End Seeds + memory.md, relevant to this design space -->

| Direction | Source | Reason |
|-----------|--------|--------|
| {direction} | {knowledge.md / memory.md} | {why not viable} |

---
_Provenance: idea pool from $design (Stream A: {N} ideas, Stream B: {N} ideas, Stream C: {N} ideas)_
_Locked by: $design on {date}_
_Next step: $implement_
