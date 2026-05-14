# Style Guide Compliance & UI/UX Fix Log

## Overview

This document captures the process of reading the developer docs and style guides in `style-guides/` and systematically applying them to the Origination codebase. It also documents the UI/UX issues we discovered and corrected along the way.

The guiding principle throughout was: **read the files first, then apply**. Every change made in this compliance pass was directly traceable back to a specific rule in one of the style guides or developer docs — not guesswork.

---

## The Process: Read the Docs, Then Change the Code

The developer docs in `style-guides/` define how all code in this project must be written. Each time a change was needed, the workflow was:

1. Read the relevant guide(s)
2. Audit the current code against what the guide requires
3. Make only the changes the guide calls for
4. Commit with a message referencing the guide and phase

This prevented random refactoring and ensured every change had a documented reason. When something looked off in the UI or logic, we went back to the guides to confirm what the expected behavior should be before touching anything.

---

## Style Guides Applied

### `angular-guide.md`
- Migrated all components to **Angular 21 signals** (`signal()`, `computed()`, `effect()`) — away from imperative `ngOnInit` / `BehaviorSubject` patterns
- Replaced `NgModule`-based architecture with standalone components
- Switched from `@Input()` / `@Output()` decorators to signal-based inputs where applicable
- Added `inject()` for dependency injection instead of constructor injection
- Applied `takeUntilDestroyed(this.destroyRef)` on all subscriptions
- Used `@for`, `@if`, `@switch` control flow syntax (new Angular template syntax)
- Moved to `templateUrl` + `styleUrl` in component metadata (no inline templates)
- Applied `provideRouter`, `provideHttpClient`, `provideAnimations` in `main.ts`

### `csharp-guide.md`
- Converted all controller actions to `async Task<IActionResult>`
- Applied `[Authorize]` on all controllers
- Converted request body types to C# `record` types (immutable DTOs)
- Added XML doc comments (`///`) to all `IDataService` methods
- Used `IHttpContextAccessor` for user context resolution
- Applied `GetCurrentUser()` helper across controllers
- Ensured consistent `NoContent()` vs `Ok()` return semantics

### `error-handling-standards.md`
- Added `GlobalErrorHandler` in Angular for uncaught exceptions — shows toast notification instead of silent failure
- Added `catchError` on all `HttpClient` calls in `ApiService`
- Backend: wrapped controller actions in try/catch, returning `Problem()` on unexpected errors
- Background refresh failures in `insights.component.ts` now show a warning toast instead of failing silently

### `sql-guide.md`
- Added `CreatedAt`, `UpdatedAt`, `CreatedBy`, `UpdatedBy` audit columns to all app-owned tables
- Applied parameterized queries everywhere — no string interpolation in SQL
- Ensured all `dbo` schema prefixes on table references
- Split connection strings: `OriginationConnection` (app DB), `DefaultConnection` (ODS), `EntitlementsConnection` (Entitlements DB)

### `git-101.md` / `git-201.md` / `git-reference.md`
- Added `CODEOWNERS` file
- Added PR description template (`.github/pull_request_template.md`)
- Structured all commit messages with a short imperative subject, blank line, and body referencing the guide/phase

### `security-guide.md`
- No secrets in `appsettings.json` — connection strings use Azure AD authentication, not passwords
- All endpoints require `[Authorize]`
- Input validation on all request bodies

### `permissions-model-guide.md`
- Trade unit filtering moved to use `dbo.vw_UserTradeUnitAccess` from the Entitlements DB — filtered by the authenticated user's UPN
- Created `EntitlementsDbContext` (read-only) and `UserTradeUnitsController`
- This replaced the incorrect use of `getTradeUnitGroups()` (app DB, not user-filtered) with `getUserTradeUnits()` (Entitlements DB, user-filtered)

---

## UI/UX Issues Found and Fixed

When the branch was first compared against `main`, several visual and behavioral discrepancies were found. These were fixed by reading `main` as the reference and correcting this branch to match.

### Brand Colors Were Wrong
- Generic Tailwind `blue-*`, `gray-*`, and `green-*` classes were being used throughout
- Fixed: the `green` Tailwind scale in `tailwind.config.js` was remapped to Scoular's primary brand blues so existing `green-*` classes map to the correct brand color without touching every file
- Added explicit `scoular-*` tokens (`scoular-green`, `scoular-yellow`, `scoular-gray`, `scoular-teal`, `scoular-red`, `scoular-cream`) to match the Scoular brand palette exactly

### Heading Sizes Were Too Large
- Several screens used raw `<h1>`–`<h3>` tags without size overrides, causing them to pick up browser default heading sizes that were too large for the design
- Fix: Scoular typescale was added to `@layer base` in `tailwind.config.js` so heading sizes are consistently controlled
- Actionable insight card titles were initially too large (`h3` defaulting to heading size) — changed to `p` with `text-base font-semibold`

### Customer Profile Card Layout
- The card structure did not match `main` — sections were in different order, some were missing
- Fixed card layout: Contact → Farm Details → eSign section, with consistent section header style (`text-gray-500 uppercase tracking-wider font-semibold`)

### Nav Labels and Button Sizing
- Nav item labels were slightly larger/smaller than `main`
- Button padding and badge sizes were inconsistent
- Fixed by reading the component in `main` and matching exactly

### Header: Logo, Profile Menu, Environment Badge
- The header was missing the Scoular logo SVG
- Profile menu (account name, sign out) was not present
- Environment badge (DEV/QA label) was missing or mislabeled
- Fixed: rebuilt the header component to match `main` exactly

### eSign Panel: Guild Was Showing
- The eSign recipients panel was showing both Guild recipients and ScoularView recipients
- Per user instruction: only show ScoularView recipients when the eSign badge is clicked
- Fixed: removed the Guild section entirely from `customer-profile.component.html`

### Trade Groups Dropdown Was Missing Groups
- The customer list's Trade Groups dropdown was populated from `getTradeUnitGroups()` which reads from the app DB — all groups, not filtered by user
- The correct source is `dbo.vw_UserTradeUnitAccess` from the Entitlements DB, which filters by the authenticated user's UPN
- Fixed: added `UserTradeUnitsController`, `EntitlementsDbContext`, and switched the frontend to call `getUserTradeUnits()`

---

## Key Lesson: Always Read the Guide Before Changing Code

Several times during this process, a change was started without fully reading the relevant guide first, which led to needing to revert or redo work. The pattern that worked was:

1. Open the relevant guide in `style-guides/`
2. Read the specific section that applies
3. Find the matching code
4. Make the targeted change
5. Verify it matches what the guide says, not just what "looks right"

For future sessions: if something looks off or you're unsure how something should be structured, the answer is almost always in one of the files in `style-guides/`. Read it before writing code.

---

## Files Changed in This Pass

### Backend (`api/`)
- `Program.cs` — DbContext registrations, service registration
- `Data/ApplicationDbContext.cs` — table names, audit columns, eSign enrollment table
- `Data/EntitlementsDbContext.cs` — new, read-only context for Entitlements DB
- `Controllers/UserTradeUnitsController.cs` — new, queries `vw_UserTradeUnitAccess`
- `Models/UserTradeUnitAccess.cs` — new, projection model
- `Services/SqlDataService.cs` — `EnrichCustomersWithESignAsync`, audit columns, `GetCurrentUser`
- `appsettings.json` / `appsettings.Development.json` — added `EntitlementsConnection`
- `Data/Migrations/` — `AddESignEnrollment` migration (incremental, correct folder)

### Frontend (`client/src/`)
- `app/core/services/api.service.ts` — added `getUserTradeUnits()`
- `app/features/customers/components/customer-list/customer-list.component.ts` — switched to `getUserTradeUnits()`
- `app/features/customers/components/customer-profile/customer-profile.component.html` — removed Guild section from eSign panel
- `app/features/customers/pages/insights/insights.component.html` — fixed insight card title sizing
- `tailwind.config.js` — Scoular brand color tokens, typescale in `@layer base`
- `index.html` — page title changed from "Grain Originator Portal" to "Origination"

---

## Local TU Catalog Removed (Phase 1 of Database Cleanup)

When the Trade Groups dropdown was switched to `getUserTradeUnits()` (Entitlements DB) above, the original `dbo.TradeUnits`, `dbo.TradeUnitGroups`, and `dbo.GroupTradeUnits` tables in the app DB were left in place even though the frontend no longer used them. A subsequent investigation (see [database-design-issues.md](database-design-issues.md)) found only one straggler call — `getTradeUnits()` invoked by the Link Producers dialog purely to round-trip TU codes back as a query scope, which was unnecessary because the backend treats an empty scope as "all customers."

**The local TU catalog has now been removed entirely** to enforce the architectural principle that **the Entitlements DB is the sole source of truth for the TU and group catalog**. The app DB no longer maintains any local TU lookup tables.

### Removed
- Frontend: `getTradeUnits()`, `getTradeUnitGroups()`, the corresponding spec, the `getTradeUnits()` precursor in `_loadAllProducersForSearch`.
- Backend: `TradeUnitGroupsController`, `GET /api/customers/trade-units`, `IDataService.GetTradeUnitsAsync` / `GetTradeUnitGroupsAsync` and all implementations, models `TradeUnit.cs` / `TradeUnitGroup.cs` / `GroupTradeUnit`, `DbSet<>` and `OnModelCreating` configs on `ApplicationDbContext`.
- DB: migration `20260513051734_RemoveTradeUnitCatalog` drops `dbo.GroupTradeUnits`, `dbo.TradeUnits`, `dbo.TradeUnitGroups` (FK-aware order, idempotent with `DROP TABLE IF EXISTS`).
- Tests: `ControllerAuthorizationTests` no longer references `TradeUnitGroupsController`; `CustomersControllerTests.GetTradeUnits_ReturnsOkWithList` deleted.

### Principle going forward
Anything that needs the list of valid TU codes or group definitions queries the Entitlements DB via `getUserTradeUnits()` / `vw_UserTradeUnitAccess`. **Do not re-add a `dbo.TradeUnits` lookup, a `TradeUnitGroups` table, or any FK from app-DB tables to a local TU catalog.** TU codes are stored in app-DB columns (e.g. `CustomerSnapshot.TradeUnit`, `Note.TradeUnit`) as plain strings — soft references to the shared CTRM vocabulary owned by upstream systems.

---

*Last updated: 2026-05-13*
