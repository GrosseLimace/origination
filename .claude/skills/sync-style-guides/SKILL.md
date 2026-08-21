---
name: sync-style-guides
description: Refresh the repo-local style-guides/ copy from the installed scoular-skills plugin snapshot. Use when the style guides look stale, after /plugin update, or when a project-local audit skill reports a missing guide.
allowed-tools: Read, Glob, Edit, Write, Bash(git rev-parse:*), Bash(ls:*), Bash(cp:*), Bash(git status:*), Bash(git diff:*)
---

# Refresh Style Guides from the plugin snapshot

Copy the bundled style guides out of the installed `scoular-skills` plugin into this
repo's `style-guides/` directory.

## Why this repo keeps a local copy

Style guides ship inside the versioned plugin snapshot at
`${CLAUDE_PLUGIN_ROOT}/style-guides/`, so plugin-provided skills need no local copy.
This repo keeps one anyway because its **project-local** skills — `audit-arch`,
`audit-component`, `audit-error-paths`, `audit-feature`, `audit-integrations`,
`audit-method`, `audit-models` — live in `.claude/skills/` and therefore have no
`${CLAUDE_PLUGIN_ROOT}` to resolve. They reference `style-guides/*.md` repo-relative.

`SCOULAR_STYLE_GUIDES_PATH` is set to `style-guides` in `.claude/settings.json` so this
override is deliberate, not an ignored leftover. That also points the plugin's own audit
skills at this same copy, which keeps every skill reading one set of guides — at the cost
of needing this refresh after each `/plugin update`.

## Source

The installed plugin snapshot. Do **not** clone `IT/dev-standards` — that repository was
decommissioned on 2026-08-21. Canonical upstream is now
`https://scoular.ghe.com/IT/scoular-marketplace` (also reachable as `IT/claude-plugins`),
but you should read the guides out of the local plugin cache rather than the network so
the repo copy always matches the plugin version actually in use.

## Procedure

### Step 1: Locate the installed plugin snapshot

```bash
ls -d "$HOME/.claude/plugins/cache/scoular/scoular-skills"/*/style-guides | sort -V | tail -1
```

That prints the newest installed version's guide directory. If nothing is found, the
plugin is not installed or predates v0.22.13 — run `claude plugin update scoular-skills@scoular`
first, then restart Claude Code.

### Step 2: Copy into the repo

Use the literal path printed by Step 1 in place of `$SRC`.

```bash
cp -r "$SRC/." "$(git rev-parse --show-toplevel)/style-guides/"
```

### Step 3: Show what changed

```bash
git status --short style-guides/ && git diff --stat style-guides/
```

### Step 4: Report

Summarize which guides were added, modified, or removed, and name the plugin version the
copy now corresponds to. Do **not** commit automatically — let the user review.

## Notes

- Shell state does not persist between Bash tool calls; substitute literal paths.
- Guides are occasionally renamed upstream (`X-guide.md` → `X.md`). A rename shows up as
  an add plus a stale leftover — check for and remove the orphan rather than keeping both,
  and update any project-local skill that referenced the old name.
- **Four guides are deliberately retained and are NOT in the plugin.** Scoular retired them
  upstream on 2026-04-15, but this repo's project-local audit skills still depend on them:

  | Guide | Depended on by |
  |-------|----------------|
  | `refactoring-guide.md` | all 7 project-local `audit-*` skills (smells E1–E7) |
  | `error-smells-guide.md` | `audit-error-paths` (E8–E10) |
  | `integration-smells-guide.md` | `audit-integrations` |
  | `model-smells-guide.md` | `audit-models` |

  The copy step above overwrites matching filenames but leaves local-only files alone, so
  these survive a refresh. **Do not delete them as orphans.** If they ever need updating,
  the last upstream versions are at `git show e16ab391^:style-guides/<name>.md`. If a
  project-local skill stops referencing one, retire that guide with it.
