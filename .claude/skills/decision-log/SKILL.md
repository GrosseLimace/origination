---
name: decision-log
description: Record or refine architecture decisions in a durable ADR-style format with context, options, tradeoffs, and rationale. Use when the developer asks why a decision was made, wants to capture an architectural choice, or needs a written record for future maintainers.
---

# Decision Log

Capture important technical decisions so they remain understandable later.

## Workflow

### Explore

- Find the existing location for ADRs or decision records. If none exists, use the repo's documentation structure.
- Read any nearby architecture docs, roadmap notes, changelog entries, or prior decision records.
- Identify the exact decision, its scope, and the systems affected.

### Analyze

Document:

- the problem being solved
- constraints and assumptions
- options considered
- the selected option
- tradeoffs and consequences

Separate facts from hindsight.

### Plan

Choose whether the task is:

- creating a new decision record
- clarifying an existing record
- backfilling rationale for an already-implemented choice

### Implement

- Write the decision in a durable, reviewable format.
- Keep the rationale specific to this repo, not generic architecture prose.
- Link the decision to code, docs, or roadmap context when possible.

### Verify

Check that the written rationale matches the current codebase and does not contradict existing docs without calling that out.

### Report

Summarize:

- decision captured
- alternatives recorded
- follow-up actions or unresolved consequences

## Stop Conditions

- The decision owner or rationale is genuinely unknown from repo context.
- Multiple conflicting explanations exist and human clarification is required.
- The task really calls for a roadmap or changelog update rather than a durable architectural record.
