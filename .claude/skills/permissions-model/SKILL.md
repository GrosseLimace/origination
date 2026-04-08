---
name: permissions-model
description: Implement, review, or extend the enterprise permissions model using style-guides/permissions-model-guide.md. Use when adding roles, permissions, ASP.NET Core authorization, Angular permission checks, seed data, audit logging, or required permissions tests.
---

# Permissions Model

Use `style-guides/permissions-model-guide.md` for enterprise authorization work.

## Workflow

### Explore

- Read `style-guides/permissions-model-guide.md`.
- Inventory the current roles, permissions, backend enforcement points, frontend permission checks, seed data, audit logs, and tests.
- Identify whether the task is greenfield implementation, extending an existing model, or auditing drift.

### Plan

Group work by the guide's major areas:

- role and permission naming
- required tables or collections
- backend enforcement and permission resolution
- frontend services, directives, route guards, and UI rules
- seeding and migrations
- audit logging
- required test cases

Keep backend, frontend, and migration changes separately reviewable where possible.

### Implement

- Add or adjust permissions with the standard naming convention.
- Keep enforcement at the correct layers.
- Update seed data, audit logging, and tests when permissions change.
- Do not create one-off permission names or bypass patterns that conflict with the guide.

### Verify

Run the narrowest deterministic checks available, such as:

- backend build and authorization tests
- frontend tests around permission service, directive, or route guard behavior
- migration validation if the repo supports it

### Report

Summarize what changed, which permission scenarios were covered, and any required follow-up for rollout or data migration.

## Stop Conditions

- The requested change conflicts with the required permission naming or enforcement model.
- The work requires schema changes or seed migrations that are unsafe to perform without rollout planning.
- The repository lacks enough context to determine the correct authorization boundary.

## References

- `style-guides/permissions-model-guide.md`
