# style-guides/

**These are origination-owned guides only.** The shared Scoular style guides
(`csharp.md`, `angular.md`, `security.md`, `sql.md`, `logging.md`, `error-handling.md`,
`automated-testing.md`, `permissions-model.md`, the `git-*` guides, …) are **not** kept
here. They ship inside the `scoular-skills` plugin snapshot at
`${CLAUDE_PLUGIN_ROOT}/style-guides/`, which is what every plugin skill reads by default.

**Do not copy the plugin's guides into this directory.** They were vendored here until
2026-09-14, with `SCOULAR_STYLE_GUIDES_PATH=style-guides` in `.claude/settings.json`
pointing the plugin's own audit skills at the local copy. Nobody refreshed that copy after
a plugin update, so all eight shared guides silently drifted and every
`/scoular-skills:audit-*` spent weeks reviewing against stale rules. The override was
removed and the duplicates deleted; plugin skills now track the plugin version in use.

To read the current shared guides, look in the installed plugin cache:

```bash
ls -d "$HOME/.claude/plugins/cache/scoular/scoular-skills"/*/style-guides | sort -V | tail -1
```

## Why these files are still here

The repo's **project-local** audit skills live in `.claude/skills/` and therefore have no
`${CLAUDE_PLUGIN_ROOT}` to resolve — they reference `style-guides/*.md` repo-relative.
Scoular retired the smells/refactoring guides upstream on 2026-04-15 (`e16ab391`, an
automated doc-sync commit), and no plugin guide covers the material, so they are now
origination-owned content.

| Guide | Depended on by |
|-------|----------------|
| `refactoring-guide.md` | all 7 project-local `audit-*` skills (smells E1–E7) |
| `error-smells-guide.md` | `audit-error-paths` (E8–E10) |
| `integration-smells-guide.md` | `audit-integrations` |
| `model-smells-guide.md` | `audit-models` |
| `tagging.md` | no skill; Azure resource tagging policy, dropped from the plugin in v2.0.0 |

If a project-local skill stops referencing one, retire that guide with it. The last
upstream versions of the four retired guides are recoverable via
`git show e16ab391^:style-guides/<name>.md`.

## Expect a warning

With no `SCOULAR_STYLE_GUIDES_PATH` set, `/align-standards` and `/workflow-check` may flag
an *unconfigured* local `style-guides/` as a legacy leftover. It isn't — this directory is
deliberate, and the shared guides must stay out of it.
