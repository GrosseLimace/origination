---
name: sync-multiagent-skills
description: Sync skill bundles between .claude/skills/, .codex/skills/, and .gemini/skills/ within a single repo using newest-mtime-wins propagation with conflict detection. Edit a skill in any of the three trees; the next sync propagates the newest bundle. Concurrent edits within a 5-minute window flag a conflict instead of silently overwriting. .claude/skills/ is the git-tracked canonical copy. Use when adopting Codex or Gemini alongside Claude Code, after running /sync-skills, or as the first step of /kick-off.
---

# Sync Skills Across Agent CLIs (design C — newest-wins + conflict detection)

Fan out skill bundles between `.claude/skills/`, `.codex/skills/`, and `.gemini/skills/` so all three agent CLIs see the same skills. Unlike a one-way mirror, this sync lets you edit a skill from whichever tool you're using and propagates that edit to the others on the next run.

## Why this exists

- Claude Code reads `.claude/skills/`
- Codex CLI reads `.codex/skills/`
- Gemini CLI reads `.gemini/skills/`

There is no shared `.agents/skills/` directory and no first-party config to redirect. Symlinks would need admin or Developer Mode on Windows, so we use copies. A strict one-way mirror (Claude → Codex/Gemini) breaks down as soon as you actively edit through Codex or Gemini — those tools naturally write to their own dirs. **Design C**: copy-based fan-out with mtime + content-hash arbitration so edits from any direction propagate; concurrent edits within 5 minutes flag a conflict instead of silently overwriting.

## Source-of-truth model

- **Canonical for git**: `.claude/skills/` is the only one checked in. Add the others to `.gitignore`:

  ```gitignore
  .codex/skills/
  .gemini/skills/
  .claude/skills/.sync-log
  ```

- **Editable from anywhere**: edit a skill bundle in any of the three trees. The sync script picks a winner per skill on each run.
- **Audit log**: every run appends a JSON line to `.claude/skills/.sync-log` (gitignored) recording targets, propagated skills, and conflicts.

## Conflict semantics

For each skill present in two or more agent dirs:

- All bundles have identical content -> noop.
- One bundle is strictly newer than the others (gap >= 5 minutes) -> newest wins, propagates to the others.
- Two bundles edited within 5 minutes of each other AND content differs -> **conflict**. The script skips the skill and exits 2. Re-run with `--prefer claude|codex|gemini` to choose a winner.
- Skill present in only one tree -> propagate to the other active targets.

The 5-minute conflict window is in `scripts/sync.ps1` (`$Script:ConflictWindowSeconds = 300`).

## When to use

- After `/sync-skills` pulled new templates from `dev-standards`.
- When adding a new skill to any of the three trees.
- When adopting Codex or Gemini in a repo that already uses Claude Code.
- Auto-invoked by `/kick-off` when `.codex/` or `.gemini/` is detected.
- Periodically as a safety net (idempotent — a clean tree is a no-op).

## Process

### Step 1 — Detect active targets

The script auto-detects: any of `.claude/`, `.codex/`, `.gemini/` that exists at the repo root is an active target. If only `.claude/` exists, the script is a no-op (nothing to sync to).

### Step 2 — Run the sync helper

```powershell
pwsh .claude\skills\sync-multiagent-skills\scripts\sync.ps1
```

(Substitute `powershell` for `pwsh` on PSv5.1 - both work. `pwsh` is faster.)

Optional parameters:

- `-DryRun` — show planned actions without writing.
- `-Prefer claude|codex|gemini` — on conflict, force this agent's bundle to win.
- `-Json` — emit a JSON summary instead of human text.
- `-Delete NAME` — remove the named skill from all active target dirs.
- `-RepoRoot PATH` — point at a different repo (default: cwd).

The script returns:

- `0` if everything synced cleanly (or noop)
- `1` if `.claude/` is missing
- `2` if any conflicts were detected and not resolved

### Step 3 — Resolve conflicts (if any)

When the script reports a conflict, decide which side is correct, then re-run with `-Prefer`. Example:

```powershell
pwsh .claude\skills\sync-multiagent-skills\scripts\sync.ps1 -Prefer codex
```

If you need different winners for different conflicting skills in one run, that's not currently supported — handle them serially: pick the winner you trust more, run with `-Prefer X`, then for the remaining conflicts edit the canonical bundle directly to bring it forward and rerun.

### Step 4 — One-time gitignore setup (per repo)

Add the three patterns from "Source-of-truth model" above to the repo's `.gitignore` if not already present. The `.codex/skills/` and `.gemini/skills/` trees are build artifacts; the `.sync-log` is high-noise telemetry.

### Step 5 — Per-agent customization (rare)

Most skills work identically across vendors per the Agent Skills Open Standard (Anthropic, Dec 2025). If a skill needs vendor-specific text, ship `agents/<vendor>.md` inside the skill bundle (e.g. `.claude/skills/foo/agents/codex.md`). The sync script copies the entire bundle including `agents/`, so the override travels with it; the consuming tool decides whether to use the override.

(Today the sync script does not auto-rewrite SKILL.md to swap in the override — that's an extension point if needed.)

### Step 6 — Report

Sample human output:

```
sync-multiagent-skills - APPLIED
  targets:    claude, codex, gemini
  skills:     37
  propagated: 2
    foo: codex -> claude,gemini (newest-wins)
    bar: claude -> gemini (fill-missing)
  conflicts:  1
    baz: codex and claude edited within 300s with differing content
      candidates: claude@mtime=1777984795, codex@mtime=1777984796
      resolve with: -Prefer claude|codex|gemini
  noops:      34
```

## Notes

- This skill is **distinct from `/sync-skills`** (vertical, cross-repo: pulls from `dev-standards` into `.claude/skills/`). This one is horizontal, same repo: fans out within the repo.
- Run order when both apply: `/sync-skills` first (refresh canonical), then `/sync-multiagent-skills` (fan out to other agents).
- Deletions: not auto-detected. To remove a skill from all three trees, use `pwsh ... sync.ps1 -Delete NAME` or remove from each tree manually. Newest-wins logic would otherwise resurrect a skill you deleted from only one tree.
- PowerShell implementation. Works on every Scoular workstation out of the box (PSv5.1 floor). PSv7 is the fast path (`winget install --id Microsoft.PowerShell --scope user`, no admin). No Python, no `jq`, no third-party module dependency.
- The script preserves mtimes when copying so subsequent runs see consistent timestamps and don't ping-pong.
- If a future Claude Code release adds native multi-agent skill resolution, retire this skill.
