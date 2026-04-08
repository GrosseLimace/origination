---
name: codebase-orient
description: Help a developer or agent quickly understand a repository's architecture, entry points, major modules, testing layout, and conventions. Use when onboarding to a repo, asking how the project works, or needing a structured walkthrough before making changes.
---

# Codebase Orient

Create a fast, practical orientation to the current repository.

## Workflow

### Explore

- Inventory the repo structure, major directories, primary languages, frameworks, and test locations.
- Read `CLAUDE.md` and the most relevant docs if present.
- Identify entry points such as app startup, API composition root, frontend bootstrap, and scheduled/background jobs.

### Map

Explain the repo through the smallest useful set of concepts:

- what the system does
- where the main runtime entry points are
- how data and control flow through the major layers
- where shared utilities and cross-cutting concerns live
- where tests, docs, and standards are located

### Focus

Tailor the orientation to the user's likely next task:

- feature work
- bug fixing
- test writing
- deployment/release work
- general onboarding

### Verify

Check that the walkthrough matches the current repo rather than template assumptions.

### Report

Return a concise orientation with:

- major modules
- key files and directories
- important conventions
- likely first places to look for the user's next task

## Stop Conditions

- The repo is too incomplete or skeletal to infer the real architecture.
- Key runtime entry points or ownership boundaries are hidden outside the repo.
- The request really needs a deep audit rather than orientation.
