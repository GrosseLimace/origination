---
name: prod-release-summary
description: Generate a two-tier PROD release summary from the GitHub Projects "In QA" column at promotion time. Reads the cards AND the shipped code, prints the summary, and copies an email-ready version to the clipboard. By default writes NOTHING to the repo (baseline auto-detected from PROD deploy history); pass --save to persist docs/release-notes/<date>.md and build a versioned history. Reminds the user to move cards to In PROD / Closed.
allowed-tools: Read, Glob, Grep, Write, Edit, Bash(git:*), Bash(gh:*), Bash(ls:*), Bash(mkdir:*), PowerShell
---

# PROD Release Summary

Generate release notes for a PROD promotion by reading the GitHub Projects
board and the actual code that shipped.

**When to run:** immediately after (or just before) manually dispatching the
`Originations Deploy to PROD` workflow (`deploy-prod.yml`), while the release
contents are still in the **In QA** column. The user moves cards to
**In PROD / Closed** manually AFTER this runs — so "In QA" at promotion time
IS the release.

## Command Shape

- `/prod-release-summary` — **default (preview) mode:** read the board, correlate the code, print the summary in chat, and copy the email version to the clipboard. **Writes nothing to the repo.** Baseline is auto-detected from the PROD deploy history. This is the mode to use until the flow is automated.
- `/prod-release-summary --save` — everything the default does, PLUS persist the notes into the repo: write `docs/release-notes/<date>.md`, update the index, write/update `agents-docs/RELEASE-SUMMARY.yaml`, and offer a commit. Use this once you want a versioned release-notes history (and as the basis for the future Logic App / CI automation).
- `/prod-release-summary --since <sha>` — override the baseline SHA (skip auto-detection).
- `/prod-release-summary --refresh-config` — (only meaningful with `--save`) re-run project discovery and regenerate `agents-docs/RELEASE-SUMMARY.yaml`.

`--dry-run` is accepted as an alias for the default preview mode (kept for
familiarity); it behaves identically, since the default already writes nothing.

## Repo-Owned Config Contract (`--save` mode only)

In `--save` mode the skill uses `agents-docs/RELEASE-SUMMARY.yaml` as its
machine-readable source of board and repo facts. **In the default preview mode
the skill does NOT read or write this file** — it discovers the board live each
run (two quick queries) and keeps nothing on disk.

If `--save` is used and that file does not exist, run the **First-Run
Bootstrap** below before writing notes.

- If `--refresh-config` is passed, regenerate the YAML via project discovery.
- Otherwise, use the existing YAML.
- On every `--save` run, perform a lightweight drift check: run query 03
  (`graphql/03-status-field.graphql`) against the cached project ID and confirm
  the cached `in_qa` optionId still exists. If it doesn't, warn the user and
  recommend `--refresh-config`.
- Never silently overwrite an existing YAML file unless the user explicitly
  requested refresh.

### Expected YAML Shape

```yaml
metadata:
  generated_by: prod-release-summary skill (project discovery)
  generated_at: 2026-07-22
github:
  hostname: scoular.ghe.com
  owner: IT
  repo: origination
  remote_name: github          # this repo's git remote for GHE (NOT origin)
project:
  scope: repository            # repository | organization
  id: PVT_xxxx                 # ProjectV2 node ID
  number: 3
  title: Origination
  status_field_id: PVTSSF_xxxx
  status_options:              # column name -> optionId
    backlog: xxxx
    todo: xxxx
    in_progress: xxxx
    in_qa: xxxx                # the one this skill filters on
    in_prod_closed: xxxx
deploy:
  workflow: deploy-prod.yml
  branch: main
  migrations_glob: api/GrainOriginatorPortal.Infrastructure/Data/Migrations/**
  config_globs:
    - api/**/appsettings*.json
    - .github/workflows/**
    - infra/**
release_notes:
  directory: docs/release-notes
  index_file: docs/release-notes/README.md
  changelog: none              # decision: dated files only, no CHANGELOG.md
last_release:                  # convenience cache ONLY — authoritative copy is
  sha: null                    # the frontmatter of the newest docs/release-notes/*.md
  date: null
  notes_file: null
```

`last_release` rule: on every run, cross-check the cached value against the
`deployed_sha` frontmatter of the newest file in `docs/release-notes/` (and
against `gh run list` when available). If they disagree, tell the user and
prefer the notes-file value. This keeps release state derivable from the repo
alone, which matters for the future Logic App port.

## First-Run Bootstrap

### Step B1: Tooling check (run every time — fast path when already set up)

```bash
gh --version && gh auth status --hostname scoular.ghe.com
```

If `gh` is not installed:

```powershell
winget install --id GitHub.cli -e
```

Then tell the user to open a NEW terminal (PATH refresh) and authenticate.
Browser login is simplest:

```bash
gh auth login --hostname scoular.ghe.com --git-protocol https --web
```

(Alternatively, a **classic PAT created on scoular.ghe.com** — Settings >
Developer settings > Personal access tokens, NOT github.com — with scopes
`repo` and `read:project`.)

**`read:project` scope is required and the `--web` flow does NOT grant it by
default.** After login, check the scopes in `gh auth status --hostname
scoular.ghe.com`. If `read:project` is missing, have the user run:

```bash
gh auth refresh --hostname scoular.ghe.com --scopes read:project
```

Verify with `gh auth status --hostname scoular.ghe.com` before proceeding
(look for `read:project` in the token scopes). If auth fails, stop and give
the user the exact remediation command — do not continue.

### Step B2: Project discovery

1. Run the repo-level query:
   ```bash
   gh api graphql --hostname scoular.ghe.com \
     -F query=@.claude/skills/prod-release-summary/graphql/01-repo-projects.graphql \
     -f owner=IT -f name=origination
   ```
2. If no candidates, fall back to org-level:
   ```bash
   gh api graphql --hostname scoular.ghe.com \
     -F query=@.claude/skills/prod-release-summary/graphql/02-org-projects.graphql \
     -f org=IT
   ```
3. For each open candidate project, run query 03 with its node ID:
   ```bash
   gh api graphql --hostname scoular.ghe.com \
     -F query=@.claude/skills/prod-release-summary/graphql/03-status-field.graphql \
     -f projectId=<id>
   ```
4. **Selection rule:** the correct project is the open one whose single-select
   field named `Status` has options matching (case-insensitive, trimmed):
   `BACKLOG`, `TO DO`, `In Progress`, `In QA`, `In PROD / Closed`. If multiple
   projects match, list them and ask the user which one.
5. Print the resolved project title, number, and the option-name -> optionId
   table, and ask the user to confirm before writing the YAML.
6. Create `agents-docs/RELEASE-SUMMARY.yaml` (create `agents-docs/` if needed)
   and report what was generated and from where.

### Step B3: Baseline SHA (first run only)

The baseline is the commit currently live in PROD. Resolve it in this order:

1. **Workflow-run history (primary):**
   ```bash
   gh run list -R scoular.ghe.com/IT/origination --workflow deploy-prod.yml \
     --status success --limit 5 --json headSha,createdAt,displayTitle,url
   ```
   The most recent *successful* run's `headSha` is the live PROD baseline.
   **Caveat:** if the user already dispatched the new deploy and it has ALREADY
   succeeded, the newest success is the CURRENT deploy — take the second-newest.
   Ask the user which situation applies if the newest run is less than ~1 hour old.
2. **Fallback:** if run history is empty or ambiguous, show the last 10 merge
   commits on `github/main` (`git log --oneline --merges -10 github/main`) and
   ask the user which was the last PROD deploy — or accept `--since <sha>`.

## Steady-State Workflow

### Step 1: Resolve config / discover the board

- **Default preview mode:** run project discovery live (Step B2 queries) to get
  the project ID and the In QA optionId. Do NOT read or write any config file.
- **`--save` mode:** load `agents-docs/RELEASE-SUMMARY.yaml`; if missing →
  First-Run Bootstrap; if `--refresh-config` → re-run Step B2. Run the drift
  check (query 03, confirm `in_qa` optionId resolves).

### Step 2: Tooling and auth

Run Step B1's fast-path check. Fail fast with remediation if broken.

### Step 3: Determine the release range

```bash
git fetch github main --quiet && git rev-parse github/main
```

- `deployed_sha` = `github/main` HEAD (what `deploy-prod.yml` deploys).
- `baseline` resolution order:
  1. `--since <sha>` if given.
  2. `--save` mode only: `last_release.sha` from the config / newest
     `docs/release-notes/*.md` frontmatter, validated per the config-contract rule.
  3. Otherwise (default preview mode): the PROD deploy history — Step B3.
- Release range = `<baseline>..github/main`.

**Always echo the chosen baseline (SHA, date, source — notes file / run URL /
user-provided) and ask the user to confirm before generating notes.** This is
cheap insurance on every run, not just the first.

### Step 4: Query the board

Run query 04, paging until `hasNextPage` is false:

```bash
gh api graphql --hostname scoular.ghe.com \
  -F query=@.claude/skills/prod-release-summary/graphql/04-items.graphql \
  -f projectId=<project.id>
```

(pass `-f endCursor=<endCursor>` on subsequent pages, or add `--paginate` to
fetch all pages in one call — the query's cursor variable is named `$endCursor`
specifically because `--paginate` only feeds that exact variable name)

**Flag note:** the query file uses capital `-F` (reads `@file`); string
variables use lowercase `-f` (raw string — avoids `-F`'s type coercion).

Keep only items where `fieldValueByName.optionId == status_options.in_qa`.
Bucket them: **issues with linked PRs**, **PR items**, **draft cards**
(title + body only).

**Schema fallback:** if the API rejects `closedByPullRequestsReferences`,
retry the query without that block and rely on the `timelineItems` nodes to
find linked PRs.

### Step 5: Correlate cards with code

Prefer local git over API calls — the full history is already cloned.

1. PRs merged in range:
   ```bash
   git log --oneline --merges <baseline>..github/main
   ```
   Extract PR numbers from `Merge pull request #NNN from IT/<branch>` subjects.
2. Direct commits:
   ```bash
   git log --no-merges --format='%h %s' <baseline>..github/main
   ```
3. For each PR linked to a card, inspect what actually changed:
   ```bash
   git show --stat -m <mergeCommit.oid>
   ```
   Then **read the diffs of the significant files** (`git show <oid> -- <path>`)
   to genuinely understand the change — do not just paraphrase card/PR titles.
   If the merge commit isn't in the local history, fall back to
   `gh pr view <NNN> -R scoular.ghe.com/IT/origination --json title,body,files`.
4. **Draft cards:** fuzzy-match title tokens against PR/commit subjects in the
   range. If no match, include the card in What's New from its title + body
   alone, and flag it `(no code change identified)` in the technical section.
5. **Orphan checks (both directions):**
   - PRs merged in range that appear on NO In QA card → list under
     "Also shipped (not on the board)".
   - In QA cards with no commits found in range → flag: "card is In QA but no
     commits found in the release range — verify it actually shipped."
6. Detect migrations and config changes:
   ```bash
   git diff --name-only <baseline>..github/main
   ```
   Match against `deploy.migrations_glob` and `deploy.config_globs`.

### Step 6: Generate the release notes

Fill `templates/release-notes.md` (same directory as this skill):

- **What's New** — one subsection per card, plain language, written for
  business users: what changed, what it does for them, where to find it in the
  app (navigation path). No PR numbers, no file paths, no jargon.
- **Technical Notes** — changes-by-card table, "Also shipped", migrations
  (note deploy-prod.yml auto-applies them), config/infra changes, risk notes
  and rollback posture.
- Frontmatter: `release_date`, `deployed_sha` (full SHA — this is the
  authoritative baseline the NEXT run reads), `previous_sha`,
  `deploy_workflow_run` URL (from `gh run list`, or "pending"), `cards` list.

**Default preview mode:** print the fully-rendered notes in chat and write a
copy to the session scratchpad only. Do NOT touch `docs/`, the index, or any
config file. Do NOT offer a commit.

**`--save` mode:** write to `docs/release-notes/<YYYY-MM-DD>.md` (append `-2`,
`-3` suffix if a same-day file exists). Then:

- Update the index `docs/release-notes/README.md` — a table of
  `| Date | Deployed SHA | Headline |` rows, newest first (create the file
  with a one-line intro if missing).
- Update `last_release` in `agents-docs/RELEASE-SUMMARY.yaml`.

### Step 7: Email version and clipboard

Render an email-friendly plain-text version: no tables, no frontmatter, no
markdown links — "WHAT'S NEW" bullets first (feature name, what it does, where
to find it), then a short "TECHNICAL SUMMARY" appendix (PR count, migrations
yes/no, anything ops should watch). Write it to the session scratchpad as
`release-email.txt`, then copy it:

```powershell
Set-Clipboard -Value (Get-Content '<scratchpad>\release-email.txt' -Raw)
```

Also print the email version in the chat so the user can re-copy it later.

### Step 8: Wrap-up

Print, verbatim:

> Cards are still In QA. After you verify PROD, move them to **In PROD /
> Closed** manually — this skill never moves cards.

**`--save` mode only:** then offer (ask — do NOT run it automatically):

```bash
git add docs/release-notes/ agents-docs/RELEASE-SUMMARY.yaml
git commit -m "docs(release): PROD release notes <date>"
```

Do NOT commit or push without an explicit yes from the user. In default
preview mode there is nothing to commit.

## Future Automation (portability note)

This flow will eventually move to a Logic App or a CI job on `deploy-prod.yml`.
The portable core is:

- **Board query** (Steps 4): the standalone files in `graphql/` — inputs:
  project node ID + In QA optionId (both in `agents-docs/RELEASE-SUMMARY.yaml`);
  output: the list of In QA items with linked PRs.
- **Code correlation** (Step 5): inputs: baseline SHA (frontmatter of newest
  `docs/release-notes/*.md`) + `main` HEAD; output: PR/commit list + diffs.
- **Summarize/render** (Steps 6–7): inputs: items + diffs; outputs: the
  two-tier markdown file + plain-text email rendering.

All state a port needs is derivable from the repo (notes-file frontmatter) and
the YAML config — nothing lives only on a developer machine. A CI/Logic App
version additionally needs: a PAT or GitHub App token with `read:project`
(GITHUB_TOKEN cannot read org Projects v2), and — if it calls an LLM — an
API key plus an NSG egress rule from the self-hosted runners.

## Important Notes

- The git remote for GHE in this repo is **`github`**, not `origin`. Always
  use `github/main`.
- This skill is READ-ONLY against the board. Never mutate project items, never
  move cards, never close issues.
- Never commit without an explicit yes. Never push.
- PAT scopes needed: `repo`, `read:project` (classic PAT on scoular.ghe.com).
- Shell state does not persist between Bash calls — substitute literal values
  (SHAs, IDs, paths) rather than relying on exported variables.

## Testing This Skill

1. **Auth smoke test:**
   ```bash
   gh api graphql --hostname scoular.ghe.com -f query='query{viewer{login}}'
   ```
2. **Preview run (default):** `/prod-release-summary` against whatever is In QA
   right now — verifies discovery, board read, correlation, summary, and
   clipboard without touching the repo.
3. **Baseline override:** `/prod-release-summary --since <sha of 2-3 merges
   ago>` — verifies diff-scoping and card/commit correlation on a known small
   range.
4. **Draft-card test:** temporarily add a draft card to In QA, run the preview,
   confirm it appears in What's New flagged `(no code change identified)`,
   remove it.
5. **Save run (only when adopting versioned history):** `/prod-release-summary
   --save` — confirm it writes the notes file, index, YAML `last_release`,
   copies the clipboard content, and offers (but does not auto-run) the commit.
