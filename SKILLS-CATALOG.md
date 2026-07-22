# Claude Skills Catalog — Scoular Dev Standards

Available Claude Code skills maintained in the [dev-standards](https://scoular.ghe.com/IT/dev-standards) repository.

---

## Auto-Managed Skills

These skills are synced automatically from `dev-standards` via GitHub Actions. Updates arrive as PRs — no manual action needed. They use auto-detection and work across all supported project types without customization.

### Foundation Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Code Review | `/code-review` | Run a findings-first review of changed code or the wider repo, focusing on correctness, regression risk, maintainability, readability, and missing or weak test coverage |
| Env Check | `/env-check` | Verify that the local development environment matches project requirements such as SDKs, runtimes, package managers, tooling, and key config prerequisites |

### Guide-Driven Audit Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Audit Angular | `/audit-angular` | Review Angular structure, templates, state flow, forms, performance, and testing against `style-guides/angular.md`, usually in phases for larger frontends |
| Audit .NET | `/audit-dotnet` | Review C# and .NET architecture, async patterns, API design, data access, outbound calls, batching, caching, and tests against `style-guides/csharp.md` |
| Audit SQL | `/audit-sql` | Review schema design, data types, keys, indexes, foreign keys, migrations, and query quality against `style-guides/sql.md`, even when only repo artifacts are available |
| Audit Security | `/audit-security` | Review application code, secrets handling, auth flows, dependency exposure, and delivery pipeline risks against `style-guides/security.md` |
| Audit Error Handling | `/audit-error-handling` | Review exception flow, user-safe error contracts, retry behavior, failure boundaries, and operational visibility against `style-guides/error-handling.md` |
| Audit Logging | `/audit-logging` | Review structured application logging, correlation, Azure Monitor and Application Insights usage, Azure SQL logging, retention, and observability documentation against `style-guides/logging.md` |
| Permissions Model | `/permissions-model` | Implement or review authorization patterns, roles, scopes, and enforcement boundaries against `style-guides/permissions-model.md` |

### Quality Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Clean Slop | `/clean-slop` | Find and clean AI-generated technical debt such as dead code, redundant abstractions, cargo-cult patterns, misleading comments, and copy-paste noise, with findings presented before any edits |
| Test Gap Analyzer | `/test-gap-analyzer` | Identify high-risk code paths with weak or missing tests, explain the main coverage gaps, and propose the highest-value regression tests to add first |
| Perf Review | `/perf-review` | Review code and architecture for high-impact latency, throughput, memory, database, and network inefficiencies, with emphasis on measurable bottlenecks and scalability risks |

### Onboarding And Knowledge Skills

| Skill | Command | Description |
|-------|---------|-------------|
| Codebase Orient | `/codebase-orient` | Build a practical mental model of the codebase by mapping architecture, entry points, major modules, dependencies, conventions, and likely places to start work |
| Decision Log | `/decision-log` | Capture or refine architectural decisions with context, options considered, tradeoffs, rationale, and the implementation or follow-up work that should result |

**Repo location**: `.claude/skills/<skill-name>/SKILL.md`

---

## Starter Skills

These skills were copied when the repo was created. Your team owns them and can customize them for your project's conventions (file paths, branch names, etc.).

| Skill | Command | Description | What to Customize |
|-------|---------|-------------|-------------------|
| Kick-Off | `/kick-off` | Start a session with fast repo orientation by reading CLAUDE.md Session Context, recent changelog activity, and current git state | `agents-docs/` paths and any repo-specific status checks |
| Wrap-Up | `/wrap-up` | End a session by updating CHANGELOG, CLAUDE.md Session Context, ROADMAP, PROJECT-STRUCTURE, and SCHEMA.md when relevant | `agents-docs/` paths and any repo-specific documentation expectations |
| Release Notes | `/release-notes` | Find missing changelog entries from git commits and pull requests, then clean up `agents-docs/CHANGELOG.md` so the history is accurate and readable | `agents-docs/CHANGELOG.md` conventions |
| Schema Doc | `/schema-doc` | Create or refresh `agents-docs/SCHEMA.md` from migrations, SQL scripts, EF models, and other schema artifacts when no live database connection is available | schema evidence paths and `agents-docs/SCHEMA.md` conventions |
| Sync Skills | `/sync-skills` | Pull updated skill templates and `SKILLS-CATALOG.md` from dev-standards, adding new files and features while protecting repo-specific starter-skill customizations | local skill directory layout, any repo-specific skill ownership rules, and known rename aliases |
| Sync Style Guides | `/sync-style-guides` | Pull the latest shared style guides from dev-standards into this repo so review and implementation skills use current standards | Typically no changes needed |
| Sync Standard Permissions | `/sync-standard-permissions` | Merge standard Claude Code permissions into local settings without removing repo-specific additions | Typically no changes needed |

**Repo location**: `.claude/skills/<skill-name>/SKILL.md`

---

## Project-Local Skills

These skills were built for this repo and are NOT synced from dev-standards.

| Skill | Command | Description |
|-------|---------|-------------|
| PROD Release Summary | `/prod-release-summary` | At PROD promotion time, read the GitHub Projects "In QA" cards and the shipped code, then generate a two-tier release summary (business-facing What's New + technical notes) in `docs/release-notes/` with an email-ready copy on the clipboard |

**Repo location**: `.claude/skills/<skill-name>/SKILL.md`

---

## Installing a New Skill

To add a skill from dev-standards that is not in your repo yet:

1. Browse the skill in `dev-standards` (see the `starter-pack/project-root/.claude/skills/` or `sync-to-master/.claude/skills/` directories)
2. Copy the entire `<skill-name>/` directory to the repo's `.claude/skills/<skill-name>/` directory
3. Verify it works by starting a new Claude Code session and typing `/<skill-name>`

For details on skill file structure and registration, see the Claude Code documentation.

---

*This catalog is automatically synced from dev-standards. Last updated: 2026-03-30*
