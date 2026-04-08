---
name: test-gap-analyzer
description: Identify risky code paths that are weakly tested or untested, then recommend the highest-value test additions. Use when the developer asks about coverage gaps, missing tests, fragile areas, regression risk, or wants to know where new tests will pay off most.
---

# Test Gap Analyzer

Find the most important missing or weak tests in the current scope.

## Workflow

### Phase 1: Explore

- Identify the code area in scope and the relevant test projects or test directories.
- Read the local style guides that affect expected behavior, especially language-specific guides and `style-guides/error-handling-guide.md` when failure paths matter.
- Inventory existing tests before judging coverage quality.
- For large repos, split the analysis into bounded batches and summarize each batch before moving on.
- If useful and supported, optionally use sub-agents to inspect disjoint code areas in parallel. Do not depend on sub-agents for the core workflow.

### Phase 2: Findings

Look for risky code with weak test evidence:

- orchestration code that coordinates multiple systems
- conditional branches and error paths with no direct assertions
- boundary handling such as null, empty, retry, authorization, and validation cases
- recent complex changes with only happy-path coverage
- tests that exist but assert implementation details instead of behavior

Prefer risk-based analysis over raw coverage percentages.

### Phase 3: Proposal

Produce a findings-first prioritized gap list with:

- affected production files
- current test evidence
- missing behaviors to test
- suggested test type: unit, integration, API, component, or end-to-end
- priority based on likelihood and impact of regression

Present the findings and the proposed test batches before making changes. Do not add or modify tests until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval, add tests in priority order:

- start with the smallest tests that cover the highest-risk behavior
- avoid rewriting production code unless the test exposes a real defect or testability problem
- keep each added test tied to an explicit behavior gap

### Phase 5: Verify

Run the narrowest relevant test commands for the tests you analyzed or added.

Use regression verification after each approved test batch and again at the end. If no tests were added, verify that your recommendations still map to real code paths and existing suites.

### Phase 6: Report

Summarize:

- highest-risk uncovered behaviors
- where tests are strategically weak rather than absent
- recommended next tests in priority order
- any production-code risk discovered during analysis

## Stop Conditions

- The repo lacks enough runnable tests or structure to infer the intended test strategy.
- The missing coverage reflects an unresolved product or architectural decision.
- Meaningful analysis would require external systems or data not available locally.
