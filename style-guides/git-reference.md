# Git Reference

A quick-lookup companion for CLI commands, naming conventions, commit standards, and infrastructure configuration.

> **Git Guide Series**
>
> - [Git 101 — Getting Started](git-101.md) — basics, VS Code workflow, merge conflicts
> - [Git 201 — Advanced Workflows](git-201.md) — branching strategy, releases, release management
> - **Git Reference** (you are here) — CLI commands, naming conventions, commit standards

---

## Table of Contents

1. [CLI Commands Quick Reference](#cli-commands-quick-reference)
2. [GitHub CLI (gh) Commands](#github-cli-gh-commands)
3. [Branch Naming Conventions](#branch-naming-conventions)
4. [Commit Message Standards](#commit-message-standards)
5. [Branch Protection Rules](#branch-protection-rules)
6. [CODEOWNERS Setup](#codeowners-setup)
7. [CI/CD Integration (Proposed)](#cicd-integration-proposed)
8. [Reading List](#reading-list)

---

## CLI Commands Quick Reference

### Setup and Configuration

```bash
# Clone a repository (create a local copy)
git clone https://github.com/YourOrg/YourRepo.git      # HTTPS
git clone git@github.com:YourOrg/YourRepo.git           # SSH
gh repo clone YourOrg/YourRepo                           # GitHub CLI

# Configure your identity (run once per machine)
git config user.name "Your Name"
git config user.email "your.email@company.com"
```

### Daily Workflow Commands

```bash
# Start fresh — switch to main and pull latest
git checkout main
git pull origin main

# Create a feature branch
git checkout -b feature/123-description

# Stage and commit changes
git add .
git commit -m "feat(scope): description"

# Push your branch to GitHub
git push -u origin feature/123-description

# Update your branch from main
git checkout main && git pull
git checkout feature/123-description
git merge main

# Clean up after your PR is merged
git checkout main
git pull origin main
git branch -d feature/123-description
```

### Branch Management — Feature Branches

```bash
# Create a feature branch
git checkout main
git pull origin main
git checkout -b feature/user-authentication

# Work on feature, commit regularly
git add .
git commit -m "feat(auth): add login form"

# Push and create PR
git push -u origin feature/user-authentication
gh pr create --base main

# After PR is merged, clean up
git checkout main
git pull origin main
git branch -d feature/user-authentication
```

### Branch Management — Integration Branches

```bash
# Create integration branch for combined testing
git checkout main
git pull origin main
git checkout -b integration/sprint-5-testing

# Merge in features to test together
git merge --no-ff feature/user-authentication
git merge --no-ff feature/user-profile

# Push for deployment to test environment
git push -u origin integration/sprint-5-testing

# After testing — Option A: merge integration branch to main
gh pr create --base main --title "Release: Sprint 5 features"
# After merge, clean up all branches
git checkout main
git pull origin main
git branch -d integration/sprint-5-testing
git push origin --delete integration/sprint-5-testing
git branch -d feature/user-authentication feature/user-profile
git push origin --delete feature/user-authentication feature/user-profile

# After testing — Option B: merge features separately
# Create separate PRs for each feature, then delete integration branch
git push origin --delete integration/sprint-5-testing
git branch -d integration/sprint-5-testing
```

### Branch Management — Hotfix Branches

```bash
# 1. Create hotfix branch FROM THE MOST RECENT RELEASE TAG
git fetch --tags
git checkout -b hotfix/v1.2.1-fix-login-crash v1.2.0

# 2. Make your fix, commit
git add .
git commit -m "fix(auth): resolve login crash on expired sessions"

# 3. Push the hotfix branch
git push -u origin hotfix/v1.2.1-fix-login-crash

# 4. DEPLOY THE HOTFIX BRANCH DIRECTLY TO PRODUCTION
#    (via CI/CD pipeline or manual deployment)

# 5. Tag the hotfix branch as the new production release
git tag -a v1.2.1 -m "Hotfix: fix login crash"
git push origin --tags

# 6. Merge hotfix to main (so main has the fix too)
gh pr create --base main --title "Merge hotfix v1.2.1 to main"

# 7. Clean up (after PR is merged)
git checkout main
git pull origin main
git branch -d hotfix/v1.2.1-fix-login-crash
git push origin --delete hotfix/v1.2.1-fix-login-crash
```

### Subsequent Hotfixes

```bash
# Each hotfix branches from the MOST RECENT tag (which may be a previous hotfix)
git fetch --tags
git checkout -b hotfix/v1.2.2-fix-timeout v1.2.1
# ... fix, deploy hotfix branch, tag v1.2.2, merge to main ...
```

### Viewing and Inspecting

```bash
# List remote branches
git branch -r

# Fetch all remote branches
git fetch --all

# See what's different between branches
git diff main..feature/my-feature

# View commit log
git log --oneline --graph --all

# Interactive rebase before PR (clean up commits)
git rebase -i main

# Sync fork with upstream (if using forks)
git remote add upstream https://github.com/OriginalOrg/Repo.git
git fetch upstream
git checkout main
git merge upstream/main
```

### Undoing Changes

```bash
# Undo last commit (keep changes staged)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# Revert a pushed commit (creates new commit — safe for shared branches)
git revert <commit-hash>

# Restore a deleted branch
git checkout -b <branch-name> <commit-hash>

# See reflog for lost commits
git reflog
```

### Tagging and Releases

```bash
# Create annotated tag (preferred — includes metadata)
git tag -a v1.2.0 -m "Release 1.2.0: user authentication and profile features"
git push origin --tags

# Create a GitHub release with notes
gh release create v1.2.0 --title "Release 1.2.0" --notes "## What's New
- User authentication
- User profile management
- Bug fixes"

# List all tags
git tag

# List tags matching a pattern
git tag -l "v1.*"

# Show tag details
git show v1.2.0

# List releases via GitHub CLI
gh release list
```

---

## GitHub CLI (gh) Commands

```bash
# Pull Requests
gh pr create --title "Title" --body "Description"   # Create PR
gh pr create --web                                   # Create PR in browser
gh pr create --reviewer @username --label "enhancement"
gh pr list                                           # List open PRs
gh pr status                                         # View PR status
gh pr view 123                                       # View PR details
gh pr checkout 123                                   # Check out a PR locally
gh pr merge 123                                      # Merge a PR

# Issues
gh issue create --title "Bug: Login fails" --body "Description..."
gh issue list

# Repository
gh repo view --web                                   # Open repo in browser
gh repo clone YourOrg/YourRepo                       # Clone a repo
```

---

## Branch Naming Conventions

### General Rules

1. **Use lowercase letters only**
2. **Use hyphens (`-`) to separate words** (not underscores or spaces)
3. **Keep names concise but descriptive**
4. **Use alphanumeric characters and hyphens only**
5. **Do not end with a hyphen or use consecutive hyphens**

### Branch Prefixes

| Prefix | Purpose | Example |
|--------|---------|---------|
| `feature/` | New functionality | `feature/user-login` |
| `bugfix/` | Bug fixes (non-urgent) | `bugfix/null-pointer-exception` |
| `hotfix/` | Urgent production fixes | `hotfix/security-patch` |
| `integration/` | Combined testing of features | `integration/sprint-5` |
| `docs/` | Documentation only | `docs/api-reference` |
| `refactor/` | Code restructuring | `refactor/database-layer` |
| `test/` | Test additions/fixes | `test/integration-suite` |
| `chore/` | Maintenance tasks | `chore/dependency-update` |
| `story/` | User-story work (Azure DevOps) | `story/12345-add-export` |
| `task/` | Task-level work (Azure DevOps) | `task/12345-fix-typo` |
| `fix/` | Short-form bug fix | `fix/null-check` |

```rule
id: branch-name-prefix
source: git-reference.md§Branch-Prefixes
severity: error
description: PR source branch must start with an approved prefix
applies-to: [pr-branch-name]
tool: regex
args:
  pattern: '^(feature|bugfix|hotfix|story|task|chore|docs|refactor|test|integration|fix)/.+$'
message: |
  Branch name does not start with an approved prefix. Use one of:
  feature/, bugfix/, hotfix/, integration/, docs/, refactor/, test/,
  chore/, story/, task/, fix/.
```

### Including Issue Numbers

When working with GitHub Issues, include the issue number in your branch name:

```
feature/123-user-authentication
bugfix/456-login-redirect-error
```

### Examples

**Good branch names:**

- `feature/add-export-functionality`
- `feature/123-payment-processing`
- `bugfix/fix-date-parsing`
- `hotfix/2.1.1-security-vulnerability`

**Bad branch names:**

- `Feature/AddExportFunctionality` (uppercase, no hyphens)
- `my-branch` (no prefix, unclear purpose)
- `feature/add_export_functionality` (underscores)
- `feature--export` (consecutive hyphens)

---

## Commit Message Standards

We follow the **Conventional Commits** specification for consistent, meaningful commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Commit Types

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(auth): add OAuth2 login support` |
| `fix` | Bug fix | `fix(api): resolve null reference in user endpoint` |
| `docs` | Documentation only | `docs(readme): update installation instructions` |
| `style` | Formatting, whitespace | `style(lint): fix code formatting issues` |
| `refactor` | Code change (no feature/fix) | `refactor(db): simplify query builder logic` |
| `test` | Adding/fixing tests | `test(auth): add unit tests for login service` |
| `chore` | Maintenance tasks | `chore(deps): update dependencies` |
| `perf` | Performance improvement | `perf(query): optimize database queries` |
| `build` | Build system changes | `build(ci): update pipeline configuration` |
| `ci` | CI configuration | `ci(actions): add code coverage step` |

### The Seven Rules of Great Commit Messages

1. **Limit the subject line to 50 characters**
2. **Capitalize only the first letter**
3. **Do not end with a period**
4. **Use the imperative mood** ("Add feature" not "Added feature")
5. **Separate subject from body with a blank line**
6. **Wrap the body at 72 characters**
7. **Explain *what* and *why*, not *how***

```rule
id: commit-message-format
source: git-reference.md§Commit-Message-Standards
severity: error
description: "Every commit subject must follow Conventional Commits, a #workitem reference, an ADF Studio auto-commit pattern, or a merge subject"
applies-to: [pr-commit-messages]
tool: regex
args:
  pattern: '^(#[0-9]+[[:space:]]*-?[[:space:]]+.+|(feat|fix|docs|style|refactor|test|chore|perf|build|ci)(\([^)]+\))?:[[:space:]]+.+|(Adding|Updating|Deleting|Renaming|Restore)[[:space:]]+[a-zA-Z]+:[[:space:]]+.+|Merged?[[:space:]]+PR[[:space:]]+[0-9]+.*|Revert[[:space:]].+|Merge[[:space:]]+(branch|pull[[:space:]]+request).+)$'
message: |
  Commit subject does not match an accepted form. Allowed:
    - `#<workitem> - <description>`
    - `<type>(<scope>?): <description>`  (feat|fix|docs|style|refactor|test|chore|perf|build|ci)
    - `<Verb>ing <type>: <name>`         (ADF Studio auto-commit)
    - `Adding|Deleting <type>: <name>`
    - `Merged? PR <n>: ...`              (squash merge)
```

### Examples

**Simple commit:**

```
feat(export): add CSV export functionality
```

**Commit with body:**

```
fix(auth): resolve session timeout issue

Users were being logged out after 5 minutes instead of 30.
The timeout configuration was reading milliseconds as seconds.

Fixes #1234
```

**Breaking change:**

```
feat(api)!: change authentication endpoint response format

BREAKING CHANGE: The /auth/login endpoint now returns a JWT token
in the 'accessToken' field instead of 'token'. Update all clients
to use the new field name.

Closes #5678
```

### Referencing GitHub Issues

Include issue references in commits using GitHub's keywords:

```
feat(reports): add monthly summary report

Implements the monthly summary report with PDF export.

Fixes #1234
```

**GitHub Keywords for Closing Issues:**

- `Fixes #123` — Closes issue when PR is merged
- `Closes #123` — Closes issue when PR is merged
- `Resolves #123` — Closes issue when PR is merged

---

## Branch Protection Rules

### Navigate to Branch Protection Rules

1. Go to your repository on GitHub
2. Click **Settings** > **Branches**
3. Under "Branch protection rules", click **Add rule**
4. Enter the branch name pattern (e.g., `main`)

### Recommended Rules for `main`

| Rule | Setting | Purpose |
|------|---------|---------|
| **Require a pull request before merging** | Enabled | No direct commits |
| **Require approvals** | 1 approval (Phase 1) | Ensure peer review |
| **Dismiss stale pull request approvals** | Enabled | Re-review after changes |
| **Require review from Code Owners** | Enabled | Critical code oversight |
| **Require status checks to pass** | Enabled | Prevent broken builds |
| **Require branches to be up to date** | Enabled | No merge conflicts |
| **Require conversation resolution** | Enabled | All feedback addressed |
| **Require signed commits** | Optional | Verify commit authenticity |
| **Include administrators** | Enabled | No one bypasses rules |
| **Restrict who can push** | Maintainers only | Control merge access |
| **Block force pushes** | Enabled | Protect history |

> **Note**: Approval count may increase to 2 for high-risk applications. See [Open Decision Points](git-201.md#open-decision-points) in the Git 201 guide.

### Recommended Rules for `integration/*` Branches

| Rule | Setting | Purpose |
|------|---------|---------|
| **Require status checks to pass** | Enabled | Ensure tests pass |
| **Allow force pushes** | Disabled | Protect history during testing |

Integration branches are temporary and don't need the same level of protection as `main`.

### Setting Up Required Status Checks

1. First, create a GitHub Actions workflow that runs tests
2. In branch protection rules, enable "Require status checks to pass"
3. Search for and select your workflow jobs (e.g., `build`, `test`)
4. Enable "Require branches to be up to date before merging"

### Setting Up Rulesets (GitHub Enterprise/Organizations)

For more advanced control, use Repository Rulesets:

1. Go to **Settings** > **Rules** > **Rulesets**
2. Create a new ruleset with:
   - Target branches
   - Required reviewers
   - Required status checks
   - Commit message patterns
   - Branch naming patterns

---

## CODEOWNERS Setup

Create a `CODEOWNERS` file in the `.github/` directory:

```
# Default owner for everything
* @default-team

# Security team must review security-related code
/src/security/ @security-team
/src/auth/ @security-team

# Frontend team owns UI code
/src/components/ @frontend-team
*.tsx @frontend-team

# DevOps owns CI/CD configuration
/.github/ @devops-team
Dockerfile @devops-team
```

For full documentation, see [About CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

---

## CI/CD Integration (Proposed)

This section outlines how the branching strategy integrates with CI/CD pipelines. Adapt these patterns to your specific tooling and requirements.

### Pipeline Triggers by Branch

| Branch | Build & Test | Deploy | Environment |
|--------|--------------|--------|-------------|
| `feature/*` | On push and PR | Optional | Dev/Preview |
| `integration/*` | On push | Automatic | Test/Staging |
| `main` | On push | Manual/Scheduled | Production (planned releases) |
| `hotfix/*` | On push and PR | Manual trigger | Production (emergency fixes) |
| Tags (`v*`) | On create | Release artifacts | - |

### Example GitHub Actions Workflow

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, 'integration/*', 'feature/*', 'hotfix/*']
    tags: ['v*']
  pull_request:
    branches: [main]
  workflow_dispatch:  # Manual trigger for hotfix deployments
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        type: choice
        options: [production]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build
        run: # your build commands
      - name: Test
        run: # your test commands

  deploy-staging:
    needs: build-and-test
    if: startsWith(github.ref, 'refs/heads/integration/')
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Deploy to Staging
        run: # deploy to staging/test environment

  deploy-production:
    needs: build-and-test
    if: github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to Production
        run: # deploy to production

  deploy-hotfix:
    needs: build-and-test
    if: github.event_name == 'workflow_dispatch' && startsWith(github.ref, 'refs/heads/hotfix/')
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy Hotfix to Production
        run: # deploy hotfix branch to production

  create-release:
    needs: build-and-test
    if: startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    steps:
      - name: Create Release Artifacts
        run: # build Docker images, packages, etc.
```

### Key CI/CD Patterns

**Feature branches**: Run build and tests on every push. Optionally deploy to ephemeral preview environments for review.

**Integration branches**: Automatically deploy to staging/test environment when pushed. This enables QA testing of combined features.

**Main branch**: Deploy to production via manual trigger or scheduled release. Features merge to main continuously, but production deployments happen on a planned schedule — not automatically on every merge.

**Hotfix branches**: Deploy directly to production via manual trigger (workflow_dispatch). This allows emergency fixes without waiting for main. After deployment, tag the hotfix and merge to main.

**Tags**: Trigger release artifact creation (Docker images, npm packages, binaries). Tags mark what's in production for future hotfix branching.

### Environment Protection Rules

Configure GitHub environment protection for production deployments:

1. Go to **Settings** > **Environments** > **production**
2. Enable **Required reviewers** for manual approval (optional)
3. Enable **Wait timer** for delayed deployments (optional)
4. Restrict deployment to `main` branch only

### Status Checks for PRs

Ensure these checks pass before allowing merge to `main`:

- Build succeeds
- All tests pass
- Code coverage thresholds met (optional)
- Security scanning passes (optional)
- Linting passes (optional)

Configure in branch protection rules under "Require status checks to pass before merging."

---

## Reading List

### Comprehensive References

1. **[Pro Git Book](https://git-scm.com/book/en/v2)** by Scott Chacon & Ben Straub
   - *Free, comprehensive, and authoritative — the definitive Git resource*
   - Key chapters: Getting Started (Ch. 1), Git Basics (Ch. 2), Git Branching (Ch. 3), Git Internals (Ch. 10)

2. **[Git Internals — Git Objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)** — Pro Git Ch. 10
   - How blobs, trees, commits, and tags work as content-addressable objects under the hood

3. **[Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/)**
   - The specification we follow for structured commit messages

4. **[GitHub CLI Manual](https://cli.github.com/manual/)**
   - Complete reference for the `gh` command-line tool

5. **[GitHub Actions Documentation](https://docs.github.com/en/actions)**
   - Setting up CI/CD workflows for automated testing and deployment

6. **[GitHub Actions Workflow Syntax](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions)**
   - Detailed YAML syntax reference for workflow files

7. **[About CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)**
   - Setting up code ownership for automatic review requests

8. **[Managing Branch Protection Rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)**
   - Configuring branch protection on GitHub

### Quick References

- **[Git Cheat Sheet](https://education.github.com/git-cheat-sheet-education.pdf)** — GitHub's printable reference
- **[Conventional Commits Cheatsheet](https://gist.github.com/qoomon/5dfcdf8eec66a051ecd85625518cfd13)** — Quick reference for commit types
- **[Julia Evans: How Git Works](https://wizardzines.com/zines/git/)** — Illustrated zine explaining Git concepts visually (paid, with free cheat sheet and blog posts at jvns.ca)

### Recommended Learning Path

| Level | Resource | Focus |
|-------|----------|-------|
| Start Here | [Git 101](git-101.md) | Basics, VS Code workflow |
| Beginner | [git — the simple guide](https://rogerdudler.github.io/git-guide/) | Basic commands |
| Beginner | Pro Git Ch. 1-3 | Core concepts |
| Intermediate | [Git 201](git-201.md) | Branching strategy, releases |
| Intermediate | [Conventional Commits](https://www.conventionalcommits.org/) | Commit standards |
| Intermediate | [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow) | GitHub workflow |
| Advanced | Pro Git Ch. 7-10 | Advanced topics |
| Reference | [GitHub CLI Manual](https://cli.github.com/manual/) | CLI automation |

---

*Last updated: February 2026*
