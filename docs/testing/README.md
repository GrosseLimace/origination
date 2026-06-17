# Testing Guide

> **Canonical standard:** [`style-guides/automated-testing.md`](../../style-guides/automated-testing.md).
> This page is the **practical how-to** for *this* repo — what's wired up, how to run it,
> and the known gaps. When the two disagree, the style guide wins.

## Stack at a glance

| Tier | Tooling | Runs |
|------|---------|------|
| Backend unit | **xUnit** + **NSubstitute** (new) / Moq (existing) | every PR |
| Frontend unit + component | **Vitest** + **Angular Testing Library** (happy-dom), via `@analogjs/vite-plugin-angular` for real component rendering | every PR |
| E2E | **Playwright** (Chromium) | nightly / on-demand (not per-PR) |

CI: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) is the PR gate (build + frontend +
backend unit). [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) runs the E2E smoke on a
schedule / manual dispatch.

## Running the tests

### Frontend (Angular / Vitest) — `client/`
```bash
cd client
npm test              # vitest run (unit + component)
npm run test:watch    # watch mode
npm run test:coverage # + coverage (text/html/lcov)
npm run test:ui       # vitest UI
```
- Component tests use Angular Testing Library; query by **role/label/text**, never Tailwind classes (§7.4).
- Shared test helpers live in **`client/src/testing/`** (`provideTestEnvironment()` wires a no-route
  router, the HTTP testing backend, and mocked MSAL so smart components render without real auth/network).

### Backend (.NET / xUnit) — repo root
```bash
dotnet test GrainOriginatorPortal.sln                          # all unit tests
dotnet test GrainOriginatorPortal.sln --filter "Category!=Integration"   # what the PR gate runs
```
New tests use **NSubstitute** (`Substitute.For<T>()`); existing Moq tests stay until touched (§6.1).

### E2E (Playwright) — `client/`
```bash
cd client
npm run e2e:install   # one-time: installs the Chromium browser
npm run e2e           # runs tests/e2e (reuses a running `ng serve`, else starts one)
```

## Where tests live
- **Backend** (`api/GrainOriginatorPortal.Api.Tests/GrainOriginatorPortal.Api.Tests/`, the project in the `.sln`):
  `Controllers/` (Customers, Commodities, Notes, PlantingIntentions), `Middleware/GlobalExceptionHandlerTests`,
  `SanitizeCsvTests`. Controller unit tests substitute `IDataService` and instantiate the controller directly
  (no HTTP pipeline).
- **Frontend unit/component**: co-located `*.spec.ts` next to the code under `client/src/app/**`.
- **E2E**: `client/tests/e2e/` with a Page Object Model under `tests/e2e/pages/`.

## Known gaps / backlog
Tracked deviations from `automated-testing.md`, deferred deliberately:

1. **Coverage floor not enforced (§4).** `ci.yml` uploads coverage but does **not** fail below the 80%
   diff floor — intentional *report-first* rollout. Flip to a `diff-cover --fail-under 80` step once both
   suites have a baseline **and** Python/diff-cover availability on the self-hosted runner is confirmed.
2. **Active §8 deviation — two tests on the EF in-memory provider.**
   `Controllers/NotesControllerTests.cs` and `Controllers/PlantingIntentionsControllerTests.cs` assert DB
   behavior against `Microsoft.EntityFrameworkCore.InMemory`, which doesn't enforce FKs/constraints/SQL
   semantics (the false-confidence §8 bans). **Do not just delete the package — it is in use.** The fix is
   to migrate both onto the real-SQL `WebApplicationFactory` harness (item 5 below), *then* remove the
   package.
3. **No integration tier (§6.4).** No `WebApplicationFactory<Program>` + real Azure SQL tests yet; the
   `Category=Integration` filter in `ci.yml` already reserves the hook. Needs a provisioned dedicated Azure
   SQL test DB (no Docker on the Linux self-hosted runner) before the lane can run. This is where item 2's
   migration lands.
4. **E2E is a serve smoke, not a journey.** `tests/e2e/app-smoke.spec.ts` verifies the shell is served
   (a §11 smoke). A real authenticated user journey (§10) is blocked on a deliberate, env-fenced test-only
   auth bypass (must never ship to prod) — design decision pending.
5. **Housekeeping.** An orphaned duplicate test project exists at `api/GrainOriginatorPortal.Api.Tests/*.cs`
   (root level, not in the `.sln`); the canonical project is the nested one above. Remove the duplicate when
   convenient.
