# Claude Skills Catalog — Scoular Dev Standards

Available Claude Code skills maintained in the [dev-standards](https://scoular.ghe.com/IT/dev-standards) repository.

---

## Auto-Managed Skills

These skills are synced automatically from `dev-standards` via GitHub Actions. Updates arrive as PRs — no manual action needed. They use auto-detection and work across all supported project types without customization.

| Skill | Command | Description |
|-------|---------|-------------|
| Build Check | `/build-check` | Auto-detect build system (.NET, Angular, npm) and run build with structured error reporting |
| Code Review | `/code-review` | Pre-commit self-review checklist — security, error handling, code quality, and test coverage |
| Env Check | `/env-check` | Verify development environment matches project requirements (runtimes, packages, config) |
| Run Tests | `/run-tests` | Auto-detect test framework (xUnit, Karma, Jest) and run tests with pass/fail summary |

**Location in your repo**: `.claude/skills/<skill-name>/SKILL.md` (synced from `dev-standards/sync-to-master/.claude/skills/`)

---

## Starter Skills

These skills were copied when the repo was created. Your team owns them and can customize them for your project's conventions (file paths, branch names, etc.).

| Skill | Command | Description | What to Customize |
|-------|---------|-------------|-------------------|
| Kick-Off | `/kick-off` | Start-of-session orientation — reads CLAUDE.md Session Context, recent CHANGELOG, and git status | `agents-docs/` paths |
| Wrap-Up | `/wrap-up` | End-of-session documentation — updates CHANGELOG, CLAUDE.md Session Context, ROADMAP, and more | `agents-docs/` paths |
| Sync Style Guides | `/sync-style-guides` | Pull latest style guides from dev-standards into this repo | Typically no changes needed |
| Sync Standard Permissions | `/sync-standard-permissions` | Merge standard Claude Code permissions into local settings (additive only) | Typically no changes needed |

**Location in your repo**: `.claude/skills/<skill-name>/SKILL.md` (copied from `dev-standards/starter-pack/project-root/.claude/skills/`)

---

## Installing a New Skill

To add a skill from dev-standards that isn't in your repo yet:

1. Browse the skill in `dev-standards` (see the `starter-pack/project-root/.claude/skills/` or `sync-to-master/.claude/skills/` directories)
2. Copy the `<skill-name>/SKILL.md` file to `.claude/skills/<skill-name>/SKILL.md` in your repo
3. Verify it works by starting a new Claude Code session and typing `/<skill-name>`

For details on skill file structure and registration, see the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

---

*This catalog is automatically synced from dev-standards. Last updated: 2026-02-24*
