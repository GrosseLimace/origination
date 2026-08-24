# Inline rule manifest — `*.md`

The style guides in this directory are human-readable policy documents. The
PR-gate pipeline (`pipelines/templates/dev-standards-check.yml` in each
consumer repo) needs a **machine-readable** subset of those rules to
enforce them at PR time without drifting from the prose.

This file documents the inline rule-block convention used in every
`*.md`. The extraction tool at `tools/extract-rules.py` walks
each guide, parses out the rule blocks, and emits a consolidated
`rules.yaml` (repo root) that is consumed by the gate at PR time.

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
| `grep-forbidden` | `pattern`, `ignore-case?`, `except?`, `except-scope?` | input lines MUST NOT match pattern (unless they also match `except`, within `except-scope`) |
| `dotnet-format-whitespace` | _none_ | runs `dotnet format whitespace --verify-no-changes` against each csproj (skips `*/bin/*`, `*/obj/*`) |
| `bicep-lint` | _none_ | runs `az bicep build` against each `.bicep` file |
| `gitleaks` | `config?` | runs gitleaks against changed files |
| `sqlfluff` | `dialect?`, `rules?` | runs sqlfluff lint |
| `roslyn` | _none_ | requires analyzer package refs + `.editorconfig` in each csproj; runs `dotnet build /p:TreatWarningsAsErrors=true` |

> **Note on `except-scope`:** `line` (the default) tests `except` against the whole
> line, so any exempting word anywhere on it clears the match. `sql-no-select-star`
> needs that, because its `except` matches `EXISTS(SELECT` — text that precedes the
> match and is never inside it.
>
> `secret` tests `except` against the text the pattern captures in a
> `(?P<secret>...)` group, and only at the START of it. Credential rules want this:
> under `line`, a host named `sample-sql01` or a trailing `# sample` exempted the
> live password beside it (GHE #151). A rule asking for `secret` without that group
> reports a misconfiguration finding rather than scanning. Author the group in
> Python's `(?P<name>...)` spelling — `run-gate.ps1` translates it to .NET's
> `(?<name>...)`, which is the only form that engine accepts.
>
> The group must be named `secret`, lower-case. Both engines resolve it
> case-sensitively, so `(?P<Secret>...)` is a misconfiguration and is reported as
> one — it is not silently accepted and then scanned with an exemption that could
> never match.
>
> Anchored at the start rather than matched in full, deliberately: a full match
> would stop exempting `YOUR_PASSWORD_HERE`, `@Microsoft.KeyVault(...)`, `$(Var)`
> and `fake-test-password`, the last of which the org security checklist names as
> an allowed false positive. Every legitimate exemption leads with its marker; a
> credential that merely contains one does not.

> **Note:** there is intentionally no `exec` / generic-shell handler. Repository-authored
> shell commands cannot cross into the CI runner — every rule must dispatch through a
> named built-in handler. Adding a new tool requires a code change in `run-gate.py`
> (reviewed in `IT/dev-standards`), not a string in a guide.

## Build flow

1. Author edits `*.md` in this repo (`IT/scoular-marketplace`) — adds/updates the prose AND the adjacent rule block.
2. Regenerate and validate the root `rules.yaml` locally — **either** port will do, they emit identical bytes (no CI wiring for this yet, so it's a manual step before merge):
   - `pwsh -File tools/extract-rules.ps1` — needs no Python interpreter
   - `python tools/extract-rules.py` — equivalent

   Add `-Check` / `--check` to validate without writing.
3. Consumer repos pick up the current `rules.yaml` via whatever distribution mechanism is live for that repo during the dev-standards-to-plugin transition (see `../../docs/skills-factory-GUIDE.md` for the current model — this predates the plugin and hasn't been fully re-pointed).
4. Consumer-repo `pipelines/templates/dev-standards-check.yml` reads its local `rules.yaml` copy and dispatches each rule on every PR.

## Authoring guidelines

- Keep the rule block **immediately after** the prose that explains it. Reviewers should be able to read both as one unit.
- `id` is a contract — don't rename one after it's referenced in pipeline logs or pinned in a baseline.
- Prefer `tool: regex` / `tool: grep-forbidden` for things you can describe in a single pattern. If no built-in executor fits, add one to `run-gate.py` in a separate PR — do not ship a rule that needs functionality the gate cannot dispatch.
- When you add a rule, regenerate and validate `rules.yaml` locally with **either** port — `pwsh -File tools/extract-rules.ps1 -Check` or `python tools/extract-rules.py --check`. They emit byte-identical output, so whichever you have is the right one, and a manifest generated by one passes the other's check.

  This was not always true. Each port used to name itself in the file's header, and their layouts diverged, so exactly one checker could be green at a time and following its "regenerate and commit" advice broke the other. If you ever see the two disagree, that's a regression in the emitters, not something to work around by switching tools — `tools/tests/extract-rules.Parity.Tests.ps1` is what holds them together.

- A new `tool:` value must be added to the allowlist in **both** ports — `$KnownTools` in `extract-rules.ps1` and `KNOWN_TOOLS` in `extract-rules.py`. Adding it to one leaves a rule that validates for whoever runs that port and fails for everyone else. The parity suite compares the two lists.

## Prose conventions

Everything above governs rule blocks. This governs the prose around them, which is most of what a guide actually contains.

- **When a guide restates an external policy, name the version it reflects.** Deferring to "the authoritative source" is only sound while every reader's copy of that source is current. `git-reference.md` states the GHE remote restriction and points at the org `CLAUDE.md` for the authoritative answer; a workstation carrying an older copy reads narrower, refuses a push the policy actually permits, and leaves the reader no way to tell which of the two is behind. Naming the version the page reflects turns an unresolvable disagreement into a dated one. From GHE #125.
