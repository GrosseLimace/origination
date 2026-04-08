---
name: sync-style-guides
description: Sync Style Guides from dev-standards — copies the style-guides directory from the GHE dev-standards repo into dev-standards/style-guides/ and updates the Coding Standards index in CLAUDE.md.
allowed-tools: Read, Glob, Edit, Write, Bash(git rev-parse:*), Bash(git clone:*), Bash(ls:*), Bash(mkdir:*), Bash(cp:*), Bash(rm:*), Bash(git status:*), Bash(git diff:*)
---

# Sync Style Guides from dev-standards

Sync the `style-guides/` subdirectory from the GitHub Enterprise `dev-standards`
repository into `dev-standards/style-guides/` within the current project.

## Source

- Repository: `https://scoular.ghe.com/IT/dev-standards`
- Branch: `main`
- Subdirectory: `sync-to-master/style-guides/`

## Destination

- `dev-standards/style-guides/` within the current repository

## Procedure

Execute the following steps using the Bash tool. Run each step as a separate
command so you can verify success before proceeding.

### Step 1: Determine the repo root and create a temp clone

```bash
REPO_ROOT=$(git rev-parse --show-toplevel) && echo "Repo root: $REPO_ROOT" && TEMP_DIR=$(mktemp -d) && echo "Temp directory: $TEMP_DIR" && git clone --depth 1 --branch main --single-branch "https://scoular.ghe.com/IT/dev-standards" "$TEMP_DIR/dev-standards"
```

If the clone fails, stop and report the error to the user. It likely means a
network or authentication issue with GHE.

### Step 2: Verify the style-guides directory exists in the clone

```bash
ls "$TEMP_DIR/dev-standards/sync-to-master/style-guides/"
```

Replace `$TEMP_DIR` with the literal path printed in Step 1.

If `sync-to-master/style-guides/` does not exist, clean up with `rm -rf "$TEMP_DIR"` and report
that the directory was not found in the remote repository.

### Step 3: Sync the files

Copy the remote style-guides into the local directory, overwriting any files that
exist in both places. This preserves local-only files (e.g., `python_style_guide.md`)
that are not in the remote repository.

```bash
mkdir -p "$REPO_ROOT/dev-standards/style-guides"
cp -r "$TEMP_DIR/dev-standards/sync-to-master/style-guides/." "$REPO_ROOT/dev-standards/style-guides/"
```

Replace `$TEMP_DIR` and `$REPO_ROOT` with the literal paths from Step 1.

### Step 4: Clean up the temp directory

```bash
rm -rf "$TEMP_DIR"
```

Replace `$TEMP_DIR` with the literal path from Step 1.

### Step 5: Show what changed

```bash
cd "$REPO_ROOT" && git status dev-standards/style-guides/
```

```bash
cd "$REPO_ROOT" && git diff --stat dev-standards/style-guides/
```

Replace `$REPO_ROOT` with the literal path from Step 1.

### Step 6: Update CLAUDE.md

`CLAUDE.md` is the canonical instruction file for this repo. Update `CLAUDE.md`
with the style guides index.

If `CLAUDE.md` does not exist at the repo root, skip this step and tell the user.

Use the Read, Edit, and Write tools (not Bash) for this step.

#### 6a. Discover guides

Use the Glob tool to list all `*.md` files in `dev-standards/style-guides/`. Then read the first
line of each file to extract its H1 title (strip the leading `# `).

#### 6b. Build the replacement block

Build a markdown block using this exact format (one table row per guide file,
sorted alphabetically by filename):

```markdown
<!-- BEGIN STYLE-GUIDES (auto-managed by /sync-style-guides — do not edit) -->
All coding standards are maintained in the `dev-standards/style-guides/` directory. Read these before making changes:

| Guide | Path |
|-------|------|
| {H1 title} | [{filename}](dev-standards/style-guides/{filename}) |
| ... | ... |
<!-- END STYLE-GUIDES -->
```

#### 6c. Upsert into CLAUDE.md

Read `CLAUDE.md` and apply ONE of these cases:

1. **Sentinels exist** — `CLAUDE.md` already contains `<!-- BEGIN STYLE-GUIDES` and
   `<!-- END STYLE-GUIDES -->`. Replace everything from the opening sentinel line
   through the closing sentinel line (inclusive) with the new block.
2. **`## Coding Standards` exists but no sentinels** — Replace the content between
   the `## Coding Standards` heading and the next `---` or next `##` heading
   (whichever comes first) with the new block.
3. **Neither exists** — Append a new `## Coding Standards` heading followed by the
   block at the end of the file (before any trailing blank lines).

#### 6d. Update Quick Reference table (if present)

If `CLAUDE.md` contains a Quick Reference table with a "Style guides" row, update
the command/location cell to `` `dev-standards/style-guides/` ``.

### Step 7: Report results

Summarize for the user:
- How many files were added, modified, or deleted
- List the specific files that changed
- Whether CLAUDE.md was updated (and what guides are now listed)
- Remind the user to review and commit when ready (do NOT commit automatically)

## Important Notes

- Shell state (environment variables) does NOT persist between separate Bash tool
  calls. After Step 1, you must use the literal paths for both `$REPO_ROOT` and
  `$TEMP_DIR` (from the echo output) in all subsequent steps.
- All Bash commands run in Git Bash on Windows. Use forward-slash Unix-style paths.
- Do NOT commit the changes automatically. Report what changed and let the user decide.
- If this is the first sync, all files will show as new untracked files in git status.
- If this is a subsequent sync, git diff and git status will show the delta.
