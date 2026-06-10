---
name: repo-normalizer
description: >
  Normalize a repository so AGENTS.md is the canonical cross-vendor instruction file
  and CLAUDE.md is a thin Claude-Code-only shim. Migrates legacy claude-docs/ to
  agents-docs/, leaves .claude/skills/ as the canonical git-tracked skills tree, and
  hands off multi-agent skills fan-out to /sync-multiagent-skills. Detects repos where
  CLAUDE.md is currently the primary instruction file and offers to invert. PowerShell
  implementation - works on every Scoular workstation without Python.
---

# Repo Normalizer (AGENTS.md canonical, CLAUDE.md as shim)

## What this skill does

Converts a repository to the cross-vendor agent layout that emerged in late 2025:

- **`AGENTS.md`** = canonical cross-vendor instructions (Linux Foundation Agentic AI Foundation, Anthropic + OpenAI + Block; Dec 2025).
- **`CLAUDE.md`** = thin shim that points to AGENTS.md plus a small set of Claude-Code-specific notes (hooks, MCP servers, subagents).
- **`agents-docs/`** = canonical agent-facing documentation tree (renamed from legacy `claude-docs/`).
- **`.claude/skills/`** = canonical git-tracked skills tree. Multi-agent fan-out to `.codex/skills/` and `.gemini/skills/` is delegated to `/sync-multiagent-skills` per the Agent Skills Open Standard.

Multi-agent fan-out uses copy-based propagation via `/sync-multiagent-skills` (newest-mtime-wins arbitration), not symlinks. Symlink creation on Windows needs admin or Developer Mode; copies don't, so this works on any workstation out of the box.

## Why PowerShell

Scoular's standard stack is .NET + Angular. Python is the exception, not the rule. A Python-implemented utility is useless in repos without Python installed - which is most of them. PowerShell ships everywhere with zero install (PSv5.1 is the floor; PSv7 is the fast path when present). `ConvertFrom-Json` is built-in; no jq dependency.

## Cases this skill handles

- Repos with only `CLAUDE.md` (the common case - needs inversion to AGENTS.md-canonical).
- Repos with only `AGENTS.md` (already canonical - just verify shim).
- Repos with both files and overlapping or conflicting sections (merge with conflict preservation).
- Repos with `claude-docs/` but no `agents-docs/` (migrate).
- Repos with `claude-docs/` AND `agents-docs/` (merge contents, preserve collisions).
- Repos with `.codex/skills/` or `.gemini/skills/` but no `.claude/skills/` (move newest into `.claude/skills/`, hand off to `/sync-multiagent-skills`).

## Safety rules

- Default to `-DryRun`. Only change files with `-Apply`.
- Never delete user-authored content. Conflicts preserved as `AGENTS.merged.candidate.md`. Originals backed up under `agents-docs/archive/`.
- If skill bundles exist in multiple agent dirs and disagree, this skill does NOT attempt to merge them - that's `/sync-multiagent-skills`' job. The normalizer only relocates the canonical bundle into `.claude/skills/` and points the user at sync.

## How to run

From the repository root:

```powershell
# preview (no filesystem changes)
pwsh .claude\skills\repo-normalizer\scripts\normalize_repo.ps1 -DryRun

# apply
pwsh .claude\skills\repo-normalizer\scripts\normalize_repo.ps1 -Apply
```

(Substitute `powershell` for `pwsh` on PSv5.1 - both work. `pwsh` is faster.)

### Parameters

- `-Prefer agents|claude|newest` - when both `AGENTS.md` and `CLAUDE.md` define the same section, choose which one wins. Default `agents`.
- `-GitignoreMultiagent` - append the three `/sync-multiagent-skills` patterns to `.gitignore` (`.codex/skills/`, `.gemini/skills/`, `.claude/skills/.sync-log`).
- `-ClaudeOnlyHeadings "A,B,C"` - comma-separated H2 headings to keep on the Claude shim instead of merging into AGENTS.md. See defaults below.

### Default Claude-only headings

Conservative default - only sections that are genuinely Claude-Code-specific:

- `Claude-Specific Notes`
- `Claude Code Hooks`
- `MCP Servers`
- `Subagents`
- `Allowed Paths` (this is `.claude/settings.json` `permissions.allow` style)

Sections that look agent-specific but actually aren't (and ride to AGENTS.md):

- `Custom Skills` - slash commands fan out to all three vendors via `/sync-multiagent-skills`.
- `Session Management`, `Session Context` - `/kick-off` and `/wrap-up` exist for all three vendors.
- `Audit Tracking Workflow`, `Coding Standards`, `Project Overview`, `Quick Reference`, etc. - all agent-agnostic.

Override with `-ClaudeOnlyHeadings` if your repo has a section the heuristic mishandles.

## Normalization rules

### Agent files

- **Only `CLAUDE.md` exists** (most common): extract everything except the Claude-only headings into a new `AGENTS.md`. Keep the Claude-only sections in `CLAUDE.md` and add a "See `AGENTS.md` for shared instructions" pointer. Backup the pre-inversion `CLAUDE.md` under `agents-docs/archive/`.
- **Only `AGENTS.md` exists**: keep it canonical. Generate or refresh `CLAUDE.md` as a thin shim if missing.
- **Both exist**: merge per `-Prefer`. Preserve conflicts to `AGENTS.merged.candidate.md` and record them in the migration report.
- **Neither exists**: scaffold a starter `AGENTS.md` and a thin `CLAUDE.md`.

### Agent docs tree

- `agents-docs/` is canonical.
- If a repo still has `claude-docs/` and no `agents-docs/`, migrate the folder.
- If both exist, merge contents file-by-file; collisions stay in `claude-docs/` for manual review.
- Backups land under `agents-docs/archive/`.

### Skills tree

The normalizer's job here is **placement**, not propagation:

- If `.claude/skills/` exists, leave it alone - it's canonical.
- If `.claude/skills/` does NOT exist but `.codex/skills/` or `.gemini/skills/` does, move the newest of those into `.claude/skills/`. The other agent dirs stay untouched; `/sync-multiagent-skills` will reconcile them on next run.
- If two or three agent skills dirs exist with the same skill names, do NOT merge - print "run `/sync-multiagent-skills` after this" and let that skill arbitrate.
- With `-GitignoreMultiagent`, append the three patterns:

  ```gitignore
  .codex/skills/
  .gemini/skills/
  .claude/skills/.sync-log
  ```

## User-level install for the skill itself

```powershell
pwsh .claude\skills\repo-normalizer\scripts\install_user_skill.ps1
```

Default behavior: copies `repo-normalizer` into `~/.claude/skills/repo-normalizer/`. If `~/.codex/skills/` or `~/.gemini/skills/` exist, prints a tip to run `/sync-multiagent-skills` against your home directory (or pass `-AlsoCodex` / `-AlsoGemini` to copy directly).

## Expected outputs

- `AGENTS.md` - canonical cross-vendor instructions
- `CLAUDE.md` - thin shim plus Claude-only sections
- `agents-docs/` - canonical docs tree
- `agents-docs/archive/CLAUDE.md.legacy.<timestamp>` - backup of pre-inversion CLAUDE.md
- `agents-docs/plans/agent-migration-report.md` - what changed and why
- optional `AGENTS.merged.candidate.md` - when section conflicts existed

## Cross-references

- **`/sync-multiagent-skills`** - for fanning the canonical `.claude/skills/` tree out to `.codex/skills/` and `.gemini/skills/`. Run after this normalizer when you adopt Codex or Gemini.
- **Agent Skills Open Standard** (Anthropic, Dec 2025) - defines the SKILL.md format that's portable across the three vendors.
- **AGENTS.md spec** - Linux Foundation Agentic AI Foundation, Dec 2025; Anthropic + OpenAI + Block alignment.
