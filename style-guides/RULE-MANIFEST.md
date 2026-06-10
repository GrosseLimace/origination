# Inline rule manifest — `*.md`

The style guides in this directory are human-readable policy documents. The
PR-gate pipeline (`pipelines/templates/dev-standards-check.yml` in each
consumer repo) needs a **machine-readable** subset of those rules to
enforce them at PR time without drifting from the prose.

This file documents the inline rule-block convention used in every
`*.md`. The extraction tool at `tools/extract-rules.py` walks
each guide, parses out the rule blocks, and emits a consolidated
`sync-to-master/rules.yaml` that is consumed by the gate at PR time.

## Where rules live

Each rule is authored **next to the prose that explains it**, inside a
fenced code block with the `rule` info-string. Authoring rule + prose
together prevents drift between policy and enforcement.

````markdown
### No `SELECT *`

Queries must enumerate the columns they select. `SELECT *` …explanatory
prose explaining the rationale, examples, exceptions…

```rule
id: sql-no-select-star
source: sql.md§No-SELECT
severity: error
description: Queries must enumerate columns; SELECT * is not allowed
applies-to: [changed-files]
files: ['*.sql', '*.cs']
tool: grep-forbidden
args:
  pattern: 'SELECT[[:space:]]+\*[[:space:]]+FROM'
  ignore-case: true
  except: 'EXISTS[[:space:]]*\([[:space:]]*SELECT'
message: |
  Enumerate the columns instead of using SELECT *. See
  dev-standards/style-guides/sql.md §No-SELECT.
```
````

## Schema

| Field | Required | Description |
|---|---|---|
| `id` | yes | unique kebab-case identifier; stable across versions |
| `source` | yes | `<guide-file>§<anchor>` — informational, points back to the prose |
| `severity` | yes | `error` (blocks merge) or `warning` (reports, does not block) |
| `description` | yes | one-line summary of what the rule enforces |
| `applies-to` | yes | list of contexts (see below) |
| `tool` | yes | which executor to dispatch to (see below) |
| `args` | tool-specific | parameters passed to the tool |
| `files` | conditional | glob list of file patterns — required when `applies-to` includes `changed-files` |
| `message` | optional | remediation hint shown in build log when the rule fires |

### `applies-to` contexts

| Value | Meaning |
|---|---|
| `pr-branch-name` | rule checks the source branch name of the PR |
| `pr-commit-messages` | rule checks each commit subject on the PR branch |
| `changed-files` | rule runs against the set of files changed by the PR |
| `all-files` | rule runs against the full working tree (rare; cost is high) |

### `tool` executors

| Tool | Args | Behavior |
|---|---|---|
| `regex` | `pattern`, `ignore-case?` | input string MUST match pattern |
| `grep-forbidden` | `pattern`, `ignore-case?`, `except?` | input lines MUST NOT match pattern (unless they also match `except`) |
| `dotnet-format-whitespace` | _none_ | runs `dotnet format whitespace --verify-no-changes` against each csproj (skips `*/bin/*`, `*/obj/*`) |
| `bicep-lint` | _none_ | runs `az bicep build` against each `.bicep` file |
| `gitleaks` | `config?` | runs gitleaks against changed files |
| `sqlfluff` | `dialect?`, `rules?` | runs sqlfluff lint |
| `roslyn` | _none_ | requires analyzer package refs + `.editorconfig` in each csproj; runs `dotnet build /p:TreatWarningsAsErrors=true` |

> **Note:** there is intentionally no `exec` / generic-shell handler. Repository-authored
> shell commands cannot cross into the CI runner — every rule must dispatch through a
> named built-in handler. Adding a new tool requires a code change in `run-gate.py`
> (reviewed in `IT/dev-standards`), not a string in a guide.

## Build flow

1. Author edits `*.md` — adds/updates the prose AND the adjacent rule block.
2. CI on `IT/dev-standards` (`.github/workflows/sync-to-repos.yml` + a new pre-step) runs `tools/extract-rules.py`, which regenerates `sync-to-master/rules.yaml`.
3. The existing weekly sync mirrors `sync-to-master/**` into each consumer repo's `dev-standards/` directory.
4. Consumer-repo `pipelines/templates/dev-standards-check.yml` reads `dev-standards/rules.yaml` and dispatches each rule on every PR.

## Authoring guidelines

- Keep the rule block **immediately after** the prose that explains it. Reviewers should be able to read both as one unit.
- `id` is a contract — don't rename one after it's referenced in pipeline logs or pinned in a baseline.
- Prefer `tool: regex` / `tool: grep-forbidden` for things you can describe in a single pattern. If no built-in executor fits, add one to `run-gate.py` in a separate PR — do not ship a rule that needs functionality the gate cannot dispatch.
- When you add a rule, run `python tools/extract-rules.py --check` locally and make sure the generated `rules.yaml` validates.
