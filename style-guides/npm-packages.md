# Publishing npm Packages to GitHub Enterprise

A step-by-step guide for publishing npm packages to the Scoular GHE Packages registry.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Create a Personal Access Token](#create-a-personal-access-token)
4. [Configure npm Authentication](#configure-npm-authentication)
5. [Prepare Your Package](#prepare-your-package)
6. [Publish](#publish)
7. [Consuming Packages](#consuming-packages)
8. [CI/CD Authentication (GitHub Actions)](#cicd-authentication-github-actions)
9. [Version Updates](#version-updates)
10. [Troubleshooting](#troubleshooting)

---

## Overview

We host npm packages on **GitHub Enterprise Packages** under the `IT` organization. Packages use the `@it` scope and are published to the registry at:

```
https://npm.scoular.ghe.com/
```

Published packages are visible at: **scoular.ghe.com/orgs/IT/packages**

### How it works

| Concept | Value |
|---------|-------|
| **Registry URL** | `https://npm.scoular.ghe.com/` |
| **npm scope** | `@it` |
| **Package names** | `@it/design-system`, `@it/angular-components`, etc. |
| **Auth method** | Personal Access Token (classic) |

> **Why `@it`?** GitHub Packages requires the npm scope to match a GitHub org or user name. Our GHE org is `IT`, so packages must use the `@it` scope.

---

## Prerequisites

- Node.js and npm installed
- A GitHub Enterprise account at `scoular.ghe.com` with access to the `IT` organization

---

## Create a Personal Access Token

The npm registry requires a **classic Personal Access Token (PAT)** — it does not accept OAuth tokens from the `gh` CLI.

### Step 1: Generate the token

1. Go to **scoular.ghe.com**
2. Click your profile picture → **Settings**
3. In the left sidebar, click **Developer settings**
4. Click **Personal access tokens** → **Tokens (classic)**
5. Click **Generate new token** → **Generate new token (classic)**
6. Fill in:
   - **Note**: A descriptive name (e.g., `npm-publish`)
   - **Expiration**: Choose an appropriate expiration
   - **Scopes**: Select the following:
     - `write:packages` — Upload packages (includes `read:packages`)
     - `read:packages` — Download packages (auto-selected with write)
7. Click **Generate token**
8. **Copy the token immediately** — you won't see it again

### Step 2: Authorize the token for SSO

Our GHE organization uses SAML SSO enforcement. Your token will not work until you authorize it for the `IT` org.

1. On the **Personal access tokens** page, find the token you just created
2. Click **Configure SSO** (or **Enable SSO**) next to the token
3. Click **Authorize** next to the **IT** organization
4. Complete any SSO prompts if required

> **If you skip this step**, you will get a 403 error: *"Resource protected by organization SAML enforcement"*

---

## Configure npm Authentication

### For your user (one-time setup)

Run this command, replacing `YOUR_TOKEN` with the PAT you created:

```bash
npm set //npm.scoular.ghe.com/:_authToken=YOUR_TOKEN
```

This saves the token to your `~/.npmrc` file. You only need to do this once (or again when the token expires).

### For a project (checked into the repo)

Add a `.npmrc` file to your project root (or package directory) with the registry mapping:

```ini
@it:registry=https://npm.scoular.ghe.com/
```

> **Do not put your token in the project `.npmrc`** — the token belongs in your user-level `~/.npmrc` only. The project `.npmrc` just tells npm where to find `@it` packages.

---

## Prepare Your Package

### package.json requirements

Your `package.json` needs these fields:

```json
{
  "name": "@it/your-package-name",
  "version": "0.0.1",
  "description": "What this package does",
  "repository": {
    "type": "git",
    "url": "https://scoular.ghe.com/IT/your-repo.git"
  },
  "publishConfig": {
    "registry": "https://npm.scoular.ghe.com/"
  }
}
```

Key points:

- **`name`** must start with `@it/`
- **`version`** follows [semver](https://semver.org/) — start with `0.0.1` for initial development
- **`publishConfig.registry`** tells `npm publish` to use GHE instead of npmjs.com
- **`repository`** links the package to its source repo on GHE
- **Do not include `"private": true`** — this flag prevents publishing

### files field

Use the `files` field to control what gets included in the published package:

```json
{
  "files": [
    "index.css",
    "src/",
    "dist/"
  ]
}
```

Only listed files/directories will be packaged. `package.json` and `README.md` are always included automatically.

---

## Publish

### First-time publish

```bash
cd your-package-directory
npm publish
```

You should see output ending with:

```
+ @it/your-package-name@0.0.1
```

### Verify the publish

Check the package exists:

```bash
npm view @it/your-package-name --registry=https://npm.scoular.ghe.com/
```

Or visit: **scoular.ghe.com/orgs/IT/packages/npm/your-package-name**

### Preview before publishing

To see what will be included without actually publishing:

```bash
npm pack --dry-run
```

---

## Consuming Packages

### Setup (one-time per machine)

1. Create a PAT with at least `read:packages` scope (see [Create a Personal Access Token](#create-a-personal-access-token))
2. Authorize it for SSO (see [Step 2](#step-2-authorize-the-token-for-sso))
3. Configure npm:

```bash
npm set //npm.scoular.ghe.com/:_authToken=YOUR_TOKEN
```

### In your project

Add `.npmrc` to your project:

```ini
@it:registry=https://npm.scoular.ghe.com/
```

Then install normally:

```bash
npm install @it/design-system
npm install @it/angular-components
```

---

## CI/CD Authentication (GitHub Actions)

When your GitHub Actions workflow needs to install `@it` scoped packages, use the built-in `GITHUB_TOKEN` rather than a Personal Access Token. This was validated on the SIMS repository in March 2026.

### Why GITHUB_TOKEN over a PAT?

| Factor | GITHUB_TOKEN | Classic PAT |
|--------|-------------|-------------|
| Lifecycle | Auto-generated per workflow run, expires when the job ends | Must be manually created and rotated |
| Ownership | Scoped to the repository, not tied to a person | Tied to a person's GHE account and SAML session |
| Secret management | Built-in — no repo secret needed | Must be stored as a repo/org secret |
| Risk if person leaves | None | Token is revoked, CI breaks |

### Prerequisites

1. Both the consuming repo and the package source must be in the **IT** organization on `scoular.ghe.com`
2. The project has an `.npmrc` checked into the repo with scope routing:

```ini
@it:registry=https://npm.scoular.ghe.com/
```

> This file tells npm where to find `@it` packages. It does **not** contain a token.

### Workflow step

Add this step **before** `npm ci` or `npm install`:

```yaml
    - name: Authenticate to GHE npm registry
      shell: pwsh
      working-directory: ./your-angular-directory
      run: |
        Add-Content -Path .npmrc -Value "//npm.scoular.ghe.com/:_authToken=$($env:GITHUB_TOKEN)"
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This appends the token to the project `.npmrc` at build time. The token is never committed — the file modification only exists for the duration of the job.

### Complete example

```yaml
steps:
  - uses: actions/checkout@v4

  - name: Authenticate to GHE npm registry
    shell: pwsh
    working-directory: ./it-operations-angular
    run: |
      Add-Content -Path .npmrc -Value "//npm.scoular.ghe.com/:_authToken=$($env:GITHUB_TOKEN)"
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  - name: Install dependencies
    working-directory: ./it-operations-angular
    run: npm ci
```

### When you still need a PAT

- **Cross-organization access**: `GITHUB_TOKEN` is scoped to the `IT` org. If a repo outside `IT` needs `@it` packages, use a classic PAT stored as a repository secret.
- **Local development**: Developers still need a PAT in their `~/.npmrc` — see [Consuming Packages](#consuming-packages).

---

## Version Updates

When publishing updates, bump the version before publishing:

```bash
# Patch release (0.0.1 → 0.0.2) — bug fixes
npm version patch

# Minor release (0.1.0 → 0.2.0) — new features, backwards compatible
npm version minor

# Major release (1.0.0 → 2.0.0) — breaking changes
npm version major
```

Then publish:

```bash
npm publish
```

> **You cannot republish the same version.** Every publish must have a unique version number. If you need to fix a mistake, bump the version and publish again.

---

## Troubleshooting

### Error: "Permission not_found: owner not found"

The npm scope doesn't match a GHE org or user. Make sure your package name starts with `@it/`.

### Error: "Permission permission_denied: The token provided does not match expected scopes"

You're using an OAuth token (from `gh` CLI) instead of a Personal Access Token. Create a classic PAT with `write:packages` scope — see [Create a Personal Access Token](#create-a-personal-access-token).

### Error: "Resource protected by organization SAML enforcement"

Your PAT hasn't been authorized for the IT org. Go to **Settings → Developer settings → Personal access tokens**, find your token, and click **Configure SSO → Authorize** for the IT org.

### Error: 403 Forbidden (generic)

Check all of the following:
1. Token has `write:packages` scope (or `read:packages` for installs)
2. Token is authorized for SSO on the IT org
3. Package name starts with `@it/`
4. `package.json` does not have `"private": true`

### Error: "You cannot publish over the previously published versions"

You need to bump the version number. Run `npm version patch` and try again.
