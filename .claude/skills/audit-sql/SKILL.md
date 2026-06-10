---
name: audit-sql
description: Audit or remediate SQL schema, query, and migration work against style-guides/sql.md. Use when reviewing tables, columns, indexes, stored procedures, migrations, performance patterns, or Azure SQL conventions.
---

# Audit SQL

Audit SQL assets against `style-guides/sql.md`.

## Workflow

### Phase 1: Explore

- Locate `.sql` files, migrations, seed scripts, and any data-access layer that emits SQL.
- Read `style-guides/sql.md` before making any findings.
- Separate schema work from query work and from deployment/migration scripts.
- If live database access is not available, treat repo artifacts as the schema evidence source in this order: migrations, `CREATE/ALTER TABLE` scripts, EF Core model/configuration, stored procedures/views, and schema documentation such as `SCHEMA.md`.
- For large repos, split the review into bounded batches such as schema objects, queries, migrations, and data-access seams.
- If useful and supported, optionally use sub-agents to review disjoint SQL areas in parallel. Do not require sub-agents.

### Phase 2: Findings

Review one batch at a time and produce findings before proposing fixes.

Group findings by the guide's main concern areas:

- naming conventions for schema objects
- data types, nullability, keys, and referential integrity
- query formatting and readability
- indexing and performance risks
- parameterization and least-privilege concerns
- migration naming, idempotency, and Azure SQL specifics

Call out whether the issue is correctness, performance, security-adjacent, or standards drift.

Pay explicit attention to common schema-quality failures:

- surrogate IDs modeled as text instead of `INT`/`BIGINT` or justified `UNIQUEIDENTIFIER`
- parent and child key columns whose types, lengths, precision, or scale do not match
- tables missing primary keys or obvious clustered-index strategy
- missing foreign key constraints on clear relationships
- foreign key columns that lack supporting indexes
- obvious duplicate, missing, or poorly shaped indexes for joins and filters

State your confidence level based on the evidence source:

- high confidence when schema objects are directly present in migrations or SQL scripts
- medium confidence when inferred from EF Core entities/configuration
- lower confidence when relying on documentation only

Call out blind spots explicitly when you cannot inspect the live deployed schema, statistics, or actual index usage.

### Phase 3: Proposal

- Present a findings-first report with severity, affected files, and the relevant guide sections.
- Propose fix batches in reviewable units and explain the regression checks you would run for each batch.
- Do not make SQL changes until the user explicitly approves implementation.

### Phase 4: Implement

Only after explicit user approval:

- Prefer minimal, reviewable changes.
- Keep migration fixes separate from query rewrites.
- Do not redesign schema or indexing strategy broadly without an explicit rationale.

### Phase 5: Verify

Use the safest deterministic validation available:

- syntax-aware review of changed SQL
- project-specific migration or database tests
- explain/plan tooling if the repo supports it

Use regression testing after each approved fix batch and again at the end. If you cannot run database validation locally, say so before proceeding.

### Phase 6: Report

Summarize findings, what was changed, and any database-level follow-up needed.

Include:

- which schema evidence sources were reviewed
- whether a live database was inspected
- whether `SCHEMA.md` appears current or needs an update

## Stop Conditions

- Fixing the issue requires a destructive schema change.
- The repository lacks enough context to validate migration order or deployment assumptions.
- Performance claims cannot be verified without real execution context.

## References

- `style-guides/sql.md`
- `style-guides/security.md` when the finding involves injection or sensitive-data handling
- `style-guides/logging.md` when Azure SQL auditing, Query Store, or observability findings dominate
