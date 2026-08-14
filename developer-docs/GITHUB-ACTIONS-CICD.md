# Origination - GitHub Actions CI/CD Guide

This guide covers the GitHub Actions CI/CD pipeline for the Origination application, deployed from `scoular.ghe.com/IT/origination`.

## Contents

- [Overview](#overview)
- [Self-Hosted Runners](#self-hosted-runners)
- [Workflow Configuration](#workflow-configuration)
- [Action Version Pinning (Supply-Chain Hardening)](#action-version-pinning-supply-chain-hardening)
- [Workload Identity Federation (Zero-Secret Auth)](#workload-identity-federation-zero-secret-auth)
- [Repository Secrets](#repository-secrets)
- [Environments and Deployment Approvals](#environments-and-deployment-approvals)
- [Azure Permissions (What Your Workflow Can Do)](#azure-permissions-what-your-workflow-can-do)
- [npm Registry Authentication (@it packages)](#npm-registry-authentication-it-packages)
- [Troubleshooting](#troubleshooting)
- [References](#references)
- [External SPA Deployment](#external-spa-deployment)

## Overview

- **Repository**: `scoular.ghe.com/IT/origination`
- **Runners**: Self-hosted (corporate network)
- **Authentication**: OIDC via Workload Identity Federation (zero secrets)
- **Environments**: `dev` (auto), `qa` (approval), `prod` (approval)

---

## Self-Hosted Runners

All workflow jobs must use self-hosted runners:

```yaml
runs-on: self-hosted
```

**Key characteristics:**
- Runners are on the corporate network (direct access to internal resources: SQL servers, Key Vault, private endpoints)
- Pre-installed tools: .NET SDK, Node.js, Git, Azure CLI
- NOT GitHub-hosted runners (no per-minute billing, no internet egress restrictions)
- Do NOT use `runs-on: ubuntu-latest` or other GitHub-hosted labels
- **Runners have no Azure managed identity of any kind.** All Azure/SQL access from a workflow
  comes exclusively from the workflow's own OIDC-federated service principal (via `azure/login`
  below) — never from the runner VM itself. This is deliberate (a runner-level identity would be a
  standing credential with broad blast radius if any single job were compromised), not an
  oversight to work around.
- **Every job runs on a freshly created VM that is deleted immediately after that job finishes.**
  Runners are single-use (`--ephemeral` GHE registration) and the underlying VM itself is torn down
  and replaced, not restarted or reused, after every job — including jobs that fail. Nothing
  written to disk by one job (planted files, background processes, modified PATH) can persist into
  a later job, even a later job on the "same" runner pool, because there is no "same VM" across two
  jobs to persist into.

### Trust Model — What This Does and Doesn't Protect Against

The two properties above close a specific, real class of risk: **there is no standing credential on
the runner to steal, and no way for one job's code to contaminate a later job.** That is what makes
`runs-on: self-hosted` safe for the deploy/build/test pipelines this guide documents, which only
ever run on `push`/`workflow_dispatch` — i.e., already-merged, already-reviewed code.

**This does NOT mean it's safe to run arbitrary, unreviewed code on these runners.** Two things are
unchanged by the properties above:

1. **Network reachability — a smaller concern here than it first looks, given who can actually
   place code.** Runners sit on the corporate network with reach to internal resources — SQL
   servers, Key Vault, private endpoints. In the classic public-repo threat model this matters a
   lot: an anonymous attacker who couldn't otherwise touch the corporate network gains a foothold
   just by getting code onto a runner. That's not really the situation on `scoular.ghe.com` — every
   account able to push code or open a PR is already a Scoular-provisioned corporate identity (see
   the EMU note below), with their own legitimate network access that's typically equal to or
   broader than what the runner's subnet can reach. A malicious insider using a runner to reach a
   SQL server usually isn't gaining access they didn't already have from their own laptop — they're
   just taking a noisier, more traceable path to do something they could do directly. **The one
   place this doesn't fully hold:** a credential-only compromise — a phished GHE login or a stolen
   session, without the attacker also controlling the account holder's own device or network
   session — could still use the runner's network position to reach something the stolen credential
   alone wouldn't grant.
2. **Whatever privileges the job's own steps grant.** If a workflow step runs `docker run` without
   additional isolation, invokes a build tool that executes arbitrary project-defined scripts
   (MSBuild targets, npm lifecycle scripts, etc.), or otherwise grants itself elevated access on the
   runner OS, that access is exactly as available to malicious code in that job as it is to your own
   build steps. Ephemeral-VM-per-job bounds the *blast radius in time* (gone after this one job) —
   it does not bound *what that one job can do while it's running*.

**A note on who "PR-authored code" actually means here:** `scoular.ghe.com` is a GitHub Enterprise
**Managed Users (EMU)** instance — every account, including every PR author, is a Scoular-provisioned
identity synced from Entra ID via SCIM, not a free-standing
public GitHub.com account. There is no fork-and-open-a-PR path from an anonymous internet stranger
the way there is on a public open-source repo, and most generic CI/CD security-scanner heuristics
(and the security policy language they cite, e.g. "self-hosted + `pull_request`") are calibrated for
that public-repo threat model by default. **This narrows the threat, it does not eliminate it:** a
compromised or misused corporate account (phished credentials, a compromised laptop, an insider) can
still open a PR containing malicious code, same as any legitimate PR. Treat the guidance below as
insider/compromised-account risk mitigation, not anonymous-internet-attacker mitigation — the
likelihood and actor profile are different from a public repo, and (per the caveat above) that
context genuinely shrinks the network-reachability concern for a legitimate-but-malicious account.
It does NOT shrink the job-privilege exposure (item 2) — unrestricted Docker daemon access, or any
other elevated access a job's own steps grant themselves, is exactly as dangerous regardless of
whether the code coming through it belongs to a trusted employee or a compromised account.

**Practical implication: think carefully before adding a `pull_request` trigger to any job that
compiles, tests, or otherwise executes repository code** (as opposed to a job that only reads
metadata, e.g. a PR title linter). A `pull_request`-triggered job executes PR-authored code —
including code from the PR itself, not just the base branch — with full access to whatever
privileges that job's steps carry (item 2 above), for the duration of that one job. There's no
runner identity to steal, and — for a legitimate-account insider — not much of a network-reachability
upgrade over what they already have from their own laptop either (item 1 above); the credential-only-
compromise case is the one where this still matters. If you need pre-merge build/test/scan feedback
on PRs, talk to the infrastructure team about a scoped approach (a dedicated runner group, a
required-reviewer gate on the PR-triggered job, or narrowing what that specific job's steps are
allowed to do) rather than adding the trigger to an existing job unmodified.

---

## Workflow Configuration

### OIDC Login Step

Every job that interacts with Azure must include the `id-token: write` permission and the Azure login step:

```yaml
jobs:
  deploy:
    runs-on: self-hosted
    environment: dev  # or qa, prod
    permissions:
      id-token: write
      contents: read

    steps:
      - name: Azure Login (OIDC)
        uses: azure/login@858f4093d287a904987dfd22abd163280f939550  # v3.0.1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}  # Use _PROD for prod
```

**Subscription selection:**
- Dev and QA: `${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}`
- Prod: `${{ secrets.AZURE_SUBSCRIPTION_ID_PROD }}`

### Deploy Step

```yaml
      - name: Deploy to App Service
        uses: azure/webapps-deploy@02a81bead70021f5284939794bcec79c271ab383  # v3.0.8
        with:
          app-name: app-origination-dev-eus  # or -qa-eus / -eus for prod
          package: ./publish
```

**App Service naming:**

| Environment | App Service Name |
|-------------|------------------|
| Dev | `app-origination-dev-eus` |
| QA | `app-origination-qa-eus` |
| Prod | `app-origination-eus` |

### EF Core Migrations (Optional)

```yaml
      - name: Run EF Migrations
        run: |
          dotnet tool restore
          dotnet ef database update --project src/Application.Api
        env:
          ConnectionStrings__DefaultConnection: "Server=azrscosqld01.database.windows.net;Database=Origination;Authentication=Active Directory Default;Encrypt=True;TrustServerCertificate=False"
```

`Authentication=Active Directory Default` uses `DefaultAzureCredential` under the hood, which tries
several credential types in order (Environment, Workload Identity, Managed Identity, then Azure
CLI) and uses whichever succeeds first. **Self-hosted runners have no managed identity at all**
(see [Self-Hosted Runners](#self-hosted-runners) above), so that step in the chain fails
immediately and falls through to `AzureCliCredential` — which picks up the workflow's own
service principal from the `azure/login` step earlier in the job. No special handling, design-time
factory, or credential exclusion is needed; a plain `dotnet ef` invocation authenticates correctly
as long as `azure/login` ran first in the same job and that service principal has been granted the
appropriate SQL role (see [SQL Database Roles](#sql-database-roles-per-environment) below).

**Prerequisites:**
- Add a `.config/dotnet-tools.json` manifest with `dotnet-ef` in your backend project root:
  ```json
  {
    "version": 1,
    "isRoot": true,
    "tools": {
      "dotnet-ef": {
        "version": "10.0.2",
        "commands": ["dotnet-ef"]
      }
    }
  }
  ```

### Complete Workflow Example

```yaml
name: Deploy Origination

on:
  push:
    branches: [main]
    paths-ignore:
      - 'developer-docs/**'
      - 'style-guides/**'
      - '*.md'
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy'
        required: true
        type: choice
        options: [dev, qa, prod]

jobs:
  build:
    runs-on: self-hosted
    # packages: read is required for `npm ci` to install @it/* packages (an
    # explicit permissions: block drops every unlisted scope to none). Harmless
    # for .NET-only apps. See "npm Registry Authentication" below.
    permissions:
      contents: read
      packages: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1

      - name: Setup .NET
        uses: actions/setup-dotnet@a98b56852c35b8e3190ac28c8c2271da59106c68  # v6.0.0
        with:
          dotnet-version: '8.0.x'

      - name: Build and Publish
        run: dotnet publish src/Application.Api -c Release -o ./publish

      - name: Upload artifact
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a  # v7.0.1
        with:
          name: app
          path: ./publish

  deploy-dev:
    needs: build
    runs-on: self-hosted
    environment: dev
    if: github.event_name == 'push' || github.event.inputs.environment == 'dev'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@858f4093d287a904987dfd22abd163280f939550  # v3.0.1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Deploy to Dev
        uses: azure/webapps-deploy@02a81bead70021f5284939794bcec79c271ab383  # v3.0.8
        with:
          app-name: app-origination-dev-eus
          package: ./publish

  deploy-qa:
    needs: deploy-dev
    runs-on: self-hosted
    environment: qa
    if: github.event_name == 'push' || github.event.inputs.environment == 'qa'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@858f4093d287a904987dfd22abd163280f939550  # v3.0.1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Deploy to QA
        uses: azure/webapps-deploy@02a81bead70021f5284939794bcec79c271ab383  # v3.0.8
        with:
          app-name: app-origination-qa-eus
          package: ./publish

  deploy-prod:
    needs: deploy-qa
    runs-on: self-hosted
    environment: prod
    if: github.event_name == 'push' || github.event.inputs.environment == 'prod'
    permissions:
      id-token: write
      contents: read
    steps:
      - name: Download artifact
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c  # v8.0.1
        with:
          name: app
          path: ./publish

      - name: Azure Login (OIDC)
        uses: azure/login@858f4093d287a904987dfd22abd163280f939550  # v3.0.1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_PROD }}

      - name: Deploy to Prod
        uses: azure/webapps-deploy@02a81bead70021f5284939794bcec79c271ab383  # v3.0.8
        with:
          app-name: app-origination-eus
          package: ./publish
```

---

## Action Version Pinning (Supply-Chain Hardening)

Every `uses:` line in this doc (and in `deploy-workflow.yml.sample`, the actual workflow file
scaffolded into your repo) is pinned to a full **commit SHA**, not a version tag — e.g.
`actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1`, not
`actions/checkout@v7`. This is deliberate, not incidental style.

A version tag (`@v7`, `@v3`, etc.) is convenient but not immutable — the action's maintainer (or an
attacker who compromises their account) can move a tag to point at different code after the fact,
or publish a malicious release under a plausible-looking new version. This is not a theoretical
risk: several widely-used GitHub Actions have been compromised this way, with the malicious code
exfiltrating secrets from every workflow run that pulled the action by tag before the compromise
was caught. A commit SHA is immutable — once a workflow references a specific 40-character SHA, no
one can silently change what that reference points to. Keep the trailing `# vX.Y.Z` comment on
every pin; it's what makes a SHA-pinned line reviewable by a human at a glance.

**Do not "simplify" these back to floating version tags for readability** — if you see
`actions/checkout@v7` anywhere in your own workflow files (copied from an older example, a
tutorial, or another repo), replace it with the SHA-pinned form using the lookup method below.

**How to find the SHA for a given version:**
- On GitHub, open the action's repo -> Releases -> the release you want -> the commit SHA is shown
  next to the tag, or visible in the tag's own page (`github.com/{owner}/{repo}/releases/tag/{tag}`)
- Via the API/CLI: `gh api repos/{owner}/{repo}/git/refs/tags/{tag} --jq '.object.sha'`
  (add `GH_HOST=github.com` if your default `gh` host is GHE, since these are public github.com
  actions, not GHE-hosted ones)

**Keeping pins current:** a SHA pin does not update itself — enable Dependabot version updates for
GitHub Actions in the consuming repo (a `.github/dependabot.yml` with `package-ecosystem:
"github-actions"`); Dependabot tracks SHA-pinned actions correctly and opens a PR bumping both the
SHA and the version comment when a new release ships, so pinning does not trade away visibility
into available updates. Periodically check the actions this workflow depends on for new major
versions and security advisories regardless of whether Dependabot is enabled — a pinned-but-stale
action carries the same missed-fixes risk as an unpinned one, just not the same tamper risk.

---

## Workload Identity Federation (Zero-Secret Auth)

The pipeline authenticates to Azure using OIDC (OpenID Connect) tokens issued by GitHub Actions. No client secrets are stored or rotated.

```
GitHub Actions Runner
    |
    | (1) Request OIDC token from GHE
    v
GHE OIDC Provider (https://token.actions.scoular.ghe.com)
    |
    | (2) Signed JWT with subject claim
    v
Azure AD (Entra ID)
    |
    | (3) Validate token against federated credential
    v
"Origination - GitHub Actions" App Registration
    |
    | (4) Issue Azure access token
    v
Azure Resources (App Service, Resource Group, SQL)
```

**App Registration**: `Origination - GitHub Actions`
- Single registration shared across all environments
- Three federated credentials (one per environment)
- No client secret -- OIDC tokens only
- **OIDC Issuer**: `https://token.actions.scoular.ghe.com`

**Subject claims** (must match exactly):

| Environment | Subject Claim |
|-------------|---------------|
| Dev | `repo:IT/origination:environment:dev` |
| QA | `repo:IT/origination:environment:qa` |
| Prod | `repo:IT/origination:environment:prod` |

**Note on repo age:** the `repo:IT/...` form above applies to repos created before 2026-07-15.
GitHub Actions repos **created, renamed, or transferred on or after 2026-07-15** get an
immutable subject format instead, embedding org/repo IDs: `repo:IT@{orgId}/origination@{repoId}:environment:dev`.
Both forms authenticate identically once configured -- infrastructure automation queries the
correct live value automatically, so no action is needed on your side either way.

---

## Repository Secrets

These secrets are configured at the repository level by the infrastructure team. You do not need to create or manage them.

| Secret | Description |
|--------|-------------|
| `AZURE_CLIENT_ID` | Application (Client) ID of the "Origination - GitHub Actions" app registration |
| `AZURE_TENANT_ID` | Scoular tenant ID (`1521f999-f722-4a4f-9747-166f93e9b0d1`) |
| `AZURE_SUBSCRIPTION_ID_NONPROD` | Non-prod subscription (`9ae7649f-19b3-4bf0-b593-b51ce94b5ee5`) |
| `AZURE_SUBSCRIPTION_ID_PROD` | Production subscription (`53575e56-bade-48c9-a763-6964ecd3bf2f`) |

---

## Environments and Deployment Approvals

| Environment | Trigger | Approval Required | Branch Restriction | Subscription |
|-------------|---------|-------------------|---------------------|--------------|
| `dev` | Automatic on push, any branch | No -- see note below on restricting to Deployers | Any branch | Non-Prod |
| `qa` | After dev succeeds | Yes -- deployers group | Any branch | Non-Prod |
| `prod` | After qa succeeds | Yes -- deployers group | `main` only | Prod |

**How to approve a deployment (qa/prod):**
1. Navigate to the workflow run in the GHE repository
2. Click **"Review deployments"** on the pending environment
3. Select the environment and click **"Approve and deploy"**

**Manual dispatch**: Workflows can include `workflow_dispatch` with an environment input to deploy a specific environment on demand.

### Restricting `dev` Deploys to Your Deployers Team -- pending, not built

Fleet policy (2026-07-21) calls for `dev` deploys to be restricted to your repo's `origination-deployers` team, without the manual-approval click that `qa`/`prod` use. **Nothing enforces this today.** A workflow-embedded approach was built and tested against a real repo, then an independent review found it didn't actually restrict anything -- it lived in a file editable by the same population it was meant to restrict, and `dev` itself carries no GitHub-enforced protection either way, so it could be deleted or routed around by anyone with ordinary repo write access. It's been withdrawn rather than published as a false sense of security.

Real enforcement needs either a GitHub custom deployment protection rule (server-side, no manual click) or a branch + Ruleset restriction as a lower-effort fallback -- neither has been decided or built yet. Don't build your own version of this in the meantime; check with infra for current status before assuming `dev` is restricted on any repo.

---

## Azure Permissions (What Your Workflow Can Do)

### RBAC Roles (per environment)

| Role | Scope | Purpose |
|------|-------|---------|
| Reader | Resource Group | View all resources, read configuration |
| Website Contributor | App Service | Deploy code, restart app, manage slots, view logs |
| Monitoring Contributor | Application Insights | Write deployment annotations |

**What this allows:**
- Deploy application code via `azure/webapps-deploy`
- Restart the App Service
- View resource configuration and deployment logs
- Write release annotations to Application Insights on each deployment

**What this does NOT allow:**
- Modify infrastructure (Bicep deployments, networking, Key Vault)
- Access Key Vault secrets directly
- Change App Service configuration/app settings
- Modify database server settings

### SQL Database Roles (per environment)

| Role | Database | Purpose |
|------|----------|---------|
| db_datareader | Origination | Read all tables |
| db_datawriter | Origination | Insert/update/delete rows |
| db_ddladmin | Origination | Create/alter/drop tables, indexes, views |

**SQL User**: `Origination - GitHub Actions`

**What this allows:**
- Run Entity Framework Core migrations
- Seed data
- Execute integration tests that read/write the database

**SQL Servers:**
| Environment | Server |
|-------------|--------|
| Dev | `azrscosqld01.database.windows.net` |
| QA | `azrscosqlq01.database.windows.net` |
| Prod | `azrscosqlp01.database.windows.net` |

---

## npm Registry Authentication (@it packages)

If your application consumes `@it` scoped npm packages (e.g., `@it/design-system`, `@it/angular-components`) from the GHE Packages registry, your workflow needs to authenticate before `npm ci`.

### Setup

1. **Add `packages: read` to the `permissions:` block** of the job that runs `npm ci`:

```yaml
    permissions:
      contents: read
      packages: read   # required — without it, npm ci gets 401/403 from the registry
```

> **This is the step that's easy to miss.** A workflow with *any* explicit `permissions:` block drops every unlisted scope to `none`. So a job declaring only `id-token: write` + `contents: read` has `packages: none`, and the per-run `GITHUB_TOKEN` is rejected by the registry — even though both repos are in the IT org and the package is internal. If your build and deploy run in the **same** job, that job needs `packages: read` too.

2. **Commit an `.npmrc`** to your Angular/frontend project directory with scope routing:

```ini
@it:registry=https://npm.scoular.ghe.com/
```

3. **Configure `setup-node` with the GHE registry** and pass `GITHUB_TOKEN` via `NODE_AUTH_TOKEN`:

```yaml
    - name: Setup Node.js
      uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020  # v7.0.0
      with:
        node-version: '24'
        registry-url: 'https://npm.scoular.ghe.com/'
        scope: '@it'

    - name: Install dependencies
      working-directory: ./your-frontend-directory
      run: npm ci
      env:
        NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

The `registry-url` and `scope` parameters tell `setup-node` to create an `.npmrc` with auth for the `@it` scope. Only `@it/*` packages route to the GHE registry — all other packages resolve from the public npm registry as usual. The `GITHUB_TOKEN` is auto-generated per workflow run — no PAT creation, rotation, or repo secrets required.

> **Requirements**: (1) the job has `packages: read` (step 1 above); (2) both the consuming repo and the npm package source are in the **IT** organization on `scoular.ghe.com`; and (3) the `@it` package is **internal** or **public** visibility (the default for IT packages). When all three hold, the per-run `GITHUB_TOKEN` can install the package with **no per-repo access grant and no PAT** — this is validated in production (e.g. the SIMS repo). A per-repo grant via the package's *Manage Actions access* is only needed for **private**-visibility packages; cross-org consumers need a classic PAT stored as a repository secret.

For full details on the GHE npm registry (publishing, consuming, troubleshooting), see the [npm Packages Guide](style-guides/npm-packages.md).

---

## Troubleshooting

### "AADSTS700024: Client assertion is not within its valid time range"
The runner's system clock is out of sync. Contact the infrastructure team to check NTP on the self-hosted runner.

### "AADSTS70021: No matching federated identity record found"
The `environment` in your workflow job must match exactly: `dev`, `qa`, or `prod` (case-sensitive). Verify the job has `environment: dev` (not `environment: Dev` or `environment: development`).

### "ForbiddenError" on deploy
The workflow identity does not have `Website Contributor` on the target App Service. Contact the infrastructure team to verify RBAC assignments.

### Azure login succeeds but operations fail with wrong subscription
Verify you are using the correct subscription secret:
- Dev/QA: `AZURE_SUBSCRIPTION_ID_NONPROD`
- Prod: `AZURE_SUBSCRIPTION_ID_PROD`

### SQL connection fails with "Login failed for user '&lt;token-identified principal&gt;'"
This means a token was obtained but SQL Server could not map it to a database user. Since
self-hosted runners have no managed identity (see [Self-Hosted Runners](#self-hosted-runners)),
this is NOT a credential-chain conflict — the token came from the workflow's own service
principal. Check instead:
- The SQL user `Origination - GitHub Actions` doesn't exist yet on the target database, or
  was created against a different app registration than the one `azure/login` is authenticating as
- The `azure/login` step ran in a **different job** than the SQL step, or didn't complete
  successfully before it — `DefaultAzureCredential`'s Azure CLI credential only sees a login that
  happened earlier in the **same job** (each job gets a fresh runner process)
- The service principal has SQL role membership in the wrong environment's database (dev SP
  granted access, but the connection string points at qa/prod, or vice versa)

### SQL connection fails with "Login failed" (other)
- Verify the SQL user `Origination - GitHub Actions` exists on the target database
- Ensure you are using `Authentication=Active Directory Default` (not SQL auth)
- Check that the Azure login step completed successfully before the SQL step

---

## References

- [APP-REGISTRATIONS.md](APP-REGISTRATIONS.md) -- Full app registration details including the GitHub Actions registration
- [START-HERE.md](START-HERE.md) -- Infrastructure overview and getting started
- [Microsoft: Workload Identity Federation](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation)
- [azure/login action](https://github.com/azure/login)
- [azure/webapps-deploy action](https://github.com/azure/webapps-deploy)

---

## External SPA Deployment

If this application has an external SPA, it deploys to Azure Static Web App via a separate workflow or job.

### SWA Resource Names

| Environment | Static Web App | ext- Domain (testing) | Public Domain (QA/Prod only) |
|-------------|---------------|---------------------|---------------------------|
| Dev | `swa-origination-dev-eus` | `ext-origination-dev.scoular.com` | *(dev is internal only)* |
| QA | `swa-origination-qa-eus` | `ext-origination-qa.scoular.com` | `origination-qa.scoular.com` |
| Prod | `swa-origination-eus` | `ext-origination.scoular.com` | `origination.scoular.com` |

### Sample SWA Deploy Workflow

```yaml
  deploy-external-swa:
    runs-on: self-hosted
    environment: dev
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1

      - name: Azure Login (OIDC)
        uses: azure/login@858f4093d287a904987dfd22abd163280f939550  # v3.0.1
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID_NONPROD }}

      - name: Build External SPA
        run: |
          cd external
          npm ci
          npm run build -- --configuration=dev

      - name: Install SWA CLI
        run: npm install -g @azure/static-web-apps-cli

      - name: Deploy to Static Web App
        run: |
          swa deploy ./external/dist/browser \
            --resource-group rg-origination-dev-eus \
            --app-name swa-origination-dev-eus \
            --env production
```

**Authentication:** The SWA deploy uses the same OIDC workload identity as App Service deployments — no deployment token needed. The `azure/login@v3` step authenticates, and the SWA CLI uses that context with `--resource-group` and `--app-name` instead of a token. The GitHub Actions service principal has Contributor on the SWA resource.

**Important:** Do NOT use `azure/static-web-apps-deploy@v1` — it requires Docker which is not available on our self-hosted runners. Use the `@azure/static-web-apps-cli` (SWA CLI) instead, which runs natively on Node.js.

---

*Document version: 1.20 | 2026-08-13*
