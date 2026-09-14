# Application Context

This folder is the canonical reference for **what each screen of the Origination app does, where its data comes from, and what to look at when something breaks**. It is written so that someone with **no prior knowledge** of the project — a new dev or Claude reading without session context — can clone the repo, open one file, and act on it.

## Who this is for

- **A new dev onboarding** — read `Shared Infrastructure.md` first, then the screen you'll be working on.
- **An on-call engineer at 2am** — go straight to the screen's `## Troubleshooting` section.
- **Claude (or any LLM)** invoked without prior chat context — these docs are the single source of truth for "what is this screen and how do I fix it."

## How to use it

1. Find the screen in the table below.
2. Read its doc top-to-bottom (each one is short — under 10 minutes).
3. If you're going to change something, also read `Shared Infrastructure.md` so you understand the auth model, DbContext layout, and shared services that every screen builds on.

## Index

| Doc | Route | Audience hook |
| --- | --- | --- |
| [Shared Infrastructure](./Shared%20Infrastructure.md) | _(read first)_ | DbContexts, services, MSAL, route guards, the trade-unit-as-UX-filter authorization model |
| [Security Model](./SECURITY-MODEL.md) | _(read first)_ | Why trade-unit entitlements are a UX filter, not a per-user access boundary, and which endpoints are the exception |
| [Customer Home Page](./Customer%20Home%20Page.md) | `/` | Day-to-day producer view — list, profile tabs, notes sidebar, deep-link query params |
| [Build a List](./Build%20a%20List.md) | `/build-list` | NLQ-driven producer list builder, refine filters, saved lists, linked-producer entity view |
| [Actionable Insights](./Actionable%20Insights.md) | `/insights` (+ `/unshipped-bushels`) | Three urgent-work categories: Unconfirmed Contracts, Spot Loads, Unshipped Bushels |
| [Planting Intentions Dashboard](./Planting%20Intentions%20Dashboard.md) | `/dashboard` | Yield, market share, actual harvest planning by trade unit and growing season |
| [Bid Sheet](./Bid%20Sheet.md) | `/bid-sheet` _(env-gated)_ | Map-based competitor bid tracking and management |
| [Usage Dashboard](./Usage%20Dashboard.md) | `/usage-dashboard` _(admin-only, env-gated)_ | Adoption metrics, originator-level activity, query-library usage and gaps |
| [App Access Graph Check](./App%20Access%20Graph%20Check.md) | _(backend + diagnostic)_ | Entra access group read via managed identity; usage-dashboard/digest filtering; IT grants + outcome table |
| [Producer Reminders](./Producer%20Reminders.md) | `/` _(env-gated)_ | Personal follow-up reminders on the producer pane and list badge, mirrored to the user's own Outlook calendar |

## Conventions used in these docs

- **File paths** are repo-relative (e.g., `client/src/app/...`). Line numbers shown like `home.component.ts:158` are accurate at the time of writing; if the file has shifted, grep for the literal symbol or string instead.
- **Mermaid diagrams** show data flow: `UI → ApiService → Controller → DataService → DB`. GitHub renders these natively.
- **DB tables** are written schema-qualified (`originations.vw_CurrentCustomers`, `dbo.Notes`) so it's unambiguous which database they live in (ODS vs. Origination app DB).
- **Environment toggles** (`environment.bidSheetEnabled`, etc.) live in `client/src/environments/environment.ts` and its variants.
- **PRs and commits** referenced in the docs link back to `scoular.ghe.com/IT/origination` and exist for context — they're not authoritative; the code is.

## Keeping these docs accurate

When you change a screen's data flow (new API call, new DB column, removed feature), **update the corresponding doc in the same PR**. Each doc has a `## Files` table — that's the place where most updates land. The Mermaid diagram and Troubleshooting section may also need tweaks.

If you add a new screen, add a new file here following the template that the existing files use, and add it to the index above.

## Why this folder lives in `docs/` (not `developer-docs/`)

These files originally lived under `developer-docs/Application Context/`, but `developer-docs/` is periodically **overwritten by a sync from the infrastructure-as-code repo**, which silently deleted them (and `SECURITY-MODEL.md`). They were recovered and moved here under `docs/` — which is app-owned and not touched by that sync — so they can't be wiped again. Keep them here.

## Related docs (outside this folder)

- [`developer-docs/CLAUDE.md`](../../developer-docs/CLAUDE.md) — short-form onboarding and Claude-specific instructions.
- [`developer-docs/START-HERE.md`](../../developer-docs/START-HERE.md) — Azure infra, environments, auth scopes, deployment flow, new-dev checklist.
- [`developer-docs/GITHUB-ACTIONS-CICD.md`](../../developer-docs/GITHUB-ACTIONS-CICD.md) — deployment pipeline.
- [`developer-docs/NETWORK-DIAGRAM.md`](../../developer-docs/NETWORK-DIAGRAM.md) — Azure infrastructure layout.
- Root [`README.md`](../../README.md) — app architecture, full API endpoint list, SBOM.
