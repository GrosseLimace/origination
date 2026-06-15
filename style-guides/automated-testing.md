# Automated Testing Guide

> **Purpose:** This guide defines how we write **automated, developer-owned tests** — the tests that live in the codebase, run in continuous integration, and gate every merge and deployment. It covers unit testing, integration testing, component testing, end-to-end testing, regression testing, smoke testing, and performance testing for our standard stack: a .NET / C# backend, an Angular / Tailwind CSS frontend, Azure App Service deployment, and an Azure SQL application database.
>
> **What this guide is NOT.** It does not cover manual **user acceptance testing** (UAT), exploratory testing, or business sign-off. Those are activities performed by people against a running application, usually outside the repository. This guide is about *code that tests code*. The name "automated testing" is deliberate: a bare "test guide" would be ambiguous with application testing and UAT.

Normative keywords — **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY** — follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). A definition for every acronym appears on first use and again in the [Glossary](#glossary).

---

## 1. Test Categories

Every automated test **MUST** fall into one of the categories below. The category determines where the test lives, how fast it must be, what it is allowed to touch, and which continuous-integration (CI) stage runs it.

| Category | What it verifies | Touches | Speed target | Stack examples |
|---|---|---|---|---|
| **Unit** | A single class or function in isolation | In-memory only; no I/O | < 50 ms each | A C# domain service with mocked dependencies; an Angular pipe or signal-based service |
| **Integration** | Several real components wired together, including infrastructure | Real database, real HTTP pipeline | < 2 s each | An ASP.NET Core endpoint hitting a dedicated Azure SQL test database via Entity Framework Core |
| **Component** (frontend) | One Angular component rendered, exercised as a user would | Rendered Document Object Model (DOM), mocked services | < 500 ms each | A form component verified through accessible queries |
| **Contract** | An API honors its published request/response shape | Serialized boundary | < 1 s each | Verifying the error envelope from `error-handling.md` |
| **End-to-end** (E2E) | A full user journey through the deployed app | Real browser, real (or staged) backend | Seconds to minutes | A Playwright flow: sign in → submit a bid → see confirmation |
| **Regression** | A previously fixed defect stays fixed | Whatever reproduces the original bug | Inherits its tier | A unit or integration test added alongside a bug fix |
| **Smoke** | A deployment is alive and serving | Live deployment slot | Seconds | A handful of health and critical-path checks after a deploy |
| **Performance / load** | The system meets latency and throughput targets under load | Deployed environment | Minutes | A k6 or NBomber scenario against a staging slot |

> **End-to-end (E2E)** means a test driving the whole application from the outside, as a user does. **Regression** is not a separate tier — a regression test is a unit, integration, or E2E test written *because a bug escaped*; see [§9](#9-regression-testing).

---

## 2. Testing Strategy — Shape the Suite Around Where Bugs Come From

The classic 2009-era **test pyramid** (a broad base of unit tests, a sliver of E2E) remains a useful warning against slow, brittle suites dominated by broad UI tests — but it is no longer the default *shape* we aim for. For a modern .NET / Angular stack the better starting heuristic is the **Testing Trophy**: static analysis always on, focused unit tests for isolated logic, a strong middle layer of integration tests, and a thin set of high-value E2E journeys. Two forces drove the shift: most defects in service-oriented systems live at the *boundaries* between components — Entity Framework Core translation, Azure SQL behavior, authorization, serialization, dependency injection, HTTP middleware, and browser/application integration — so integration tests catch more per test; and modern browser automation (Playwright) made E2E far less flaky than the Selenium era that gave E2E its bad name.

**Principles:**

- Teams **SHOULD NOT** argue about the "correct" shape. Ask instead: *where do our defects actually come from?* and aim testing effort there.
- **Confidence per minute of test runtime** is the metric that matters — not raw test count or coverage percentage. A fast unit test that never catches a real failure is waste.
- Integration tests are the center of gravity for our backend, because that is where Entity Framework Core, Azure SQL, authorization, and the HTTP pipeline meet.
- Do **not** manage the suite by percentage quota. As a rough *starting* intuition a distribution near **70% unit / 20% integration / 10% E2E by count** is reasonable, but this is guidance, not a target — risk profile and architecture override it, and high-value integration coverage beats padding the unit count.

```text
              ╱ E2E ╲            thin — only critical user journeys
            ╱─────────╲
          ╱ Integration ╲        wide — the center of gravity
        ╱─────────────────╲
      ╱   Unit + Component   ╲    fast, focused
    ╱─────────────────────────╲
   ╱      Static analysis       ╲  compiler, linters, analyzers (free, always on)
  ╱───────────────────────────────╲
```

---

## 3. Universal Principles (All Languages, All Tiers)

1. **Test behavior, not implementation.** Assert on observable outputs and effects, never on private internals or incidental structure. A refactor that preserves behavior **MUST NOT** break tests. (Frontend corollary: never assert on Tailwind CSS classes — see [§7.4](#74-do-not-test-styling-or-implementation-details).)
2. **One reason to fail.** Each test verifies one behavior. When it fails, the name alone **SHOULD** tell you what broke.
3. **Deterministic.** A test **MUST** produce the same result on every run. No dependence on wall-clock time, time zone, random data, network flakiness, test execution order, or leftover state. Inject clocks and randomness.
4. **Independent and isolated.** Tests **MUST NOT** share mutable state or depend on another test having run first. Each test arranges its own world and cleans up after itself.
5. **Arrange–Act–Assert (AAA).** Structure every test in three visible phases. Keep the *Act* to a single call where practical.
6. **No logic in tests.** Tests **SHOULD NOT** contain `if`/`for`/`while` or duplicated production logic. A test with branching is a test that needs a test. Use parameterized cases instead.
7. **Readable over DRY.** A little duplication in tests is acceptable when it makes each test self-contained and obvious. Prefer explicit literals over computed expected values.
8. **Fast feedback.** Unit and component tests **MUST** run in the inner development loop in seconds. Slow tests belong in the integration/E2E tiers, gated separately.
9. **Test data builders.** Construct entities through builders or factory helpers with sensible defaults, so a test states only the fields it cares about.

### 3.1 Naming

- C#: `MethodOrScenario_Condition_ExpectedResult` (for example, `Swap_WhenTargetSlotIsCold_WarmsUpBeforeSwap`).
- Angular / TypeScript: `describe('ComponentOrService', ...)` with `it('should <behavior> when <condition>', ...)`.

The name **MUST** describe behavior in domain terms, not the method's call signature.

---

## 4. Coverage and Quality Gates

- Code coverage is a **floor, not a target.** Chasing a high percentage produces assertion-free tests that execute lines without verifying anything. We measure coverage to find *untested* code, not to celebrate a number.
- New and changed code **SHOULD** meet a **line-and-branch coverage floor of 80%** in the modules it touches. Legacy code is brought up to the floor opportunistically, not in a big-bang.
- Coverage **MUST** be measured per pull request on the diff, not just on the whole repository, so a large well-tested legacy base cannot mask an untested new feature.
- The CI pipeline **MUST** fail the build (not merely warn) when:
  - any test fails;
  - a test is skipped without a linked tracking issue;
  - diff coverage falls below the floor;
  - a quarantined-flaky test exceeds its time-to-fix budget (see [§5](#5-flaky-tests)).
- Every merge to a protected branch **MUST** be green on the unit, integration, and component tiers. E2E and performance suites **MAY** run on a slower cadence (pre-deploy, nightly) when they are too slow for every push, provided they gate the deployment.

---

## 5. Flaky Tests

A flaky test — one that passes and fails without code changes — is a liability, not a nuisance. Industry data puts the cost at roughly **6–8 engineer-hours per week** on teams that tolerate them, and worse: blindly **retrying** flaky tests until they pass *hides real concurrency and ordering defects* and trains the team to distrust a green build.

- Tests **MUST NOT** use automatic retry to turn a red merge gate green. Retries **MAY** be used only in a diagnostic or non-blocking lane to identify flaky behavior — and even then the flake **MUST** still be tracked and owned.
- A flaky test **MUST** be **quarantined** (moved out of the gating set into a tracked, non-blocking lane) within one business day of detection, with a ticket to fix or delete it.
- A quarantined test **MUST** have an **owner** and a **time-to-fix budget** (default: **two weeks**). At the deadline the team **MUST** either fix it, replace it with reliable coverage, or deliberately delete it. A permanently ignored flaky test is worse than no test, because it creates false confidence.
- The usual root causes — shared state, real time/dates, unawaited asynchronous work, order dependence, real network, insufficient cleanup — **MUST** be fixed at the source, not papered over.

---

## 6. Backend — .NET / C#

This section refines, for testing, the rules in `csharp.md`. Where they conflict, the more specific rule here wins for test code.

### 6.1 Frameworks and libraries

| Concern | Standard | Notes |
|---|---|---|
| Test framework + runner | **xUnit** (current major version) | NUnit or MSTest acceptable on existing projects; new projects use xUnit. |
| In-memory web host | **`Microsoft.AspNetCore.Mvc.Testing`** (`WebApplicationFactory<TEntryPoint>`) | Spins up the real HTTP pipeline without deploying. |
| Integration dependencies | **Provisioned test services** | Real Azure SQL / Redis / etc. supplied through environment-specific test resources; see [§6.4](#64-integration-tests) and [§8](#8-data-layer--azure-sql--entity-framework-core). |
| Mocking / test doubles | **NSubstitute** | **Do not adopt Moq on new projects** — Moq 4.20.0 through 4.20.1 bundled **SponsorLink**, which exfiltrated developer email hashes at build time (a supply-chain and privacy trust break). SponsorLink was removed in 4.20.2, but new projects **SHOULD** use the lower-risk standard. Existing Moq usage MAY remain until convenient to migrate. |
| Assertions | **xUnit built-in `Assert`**, or **Shouldly** / **AwesomeAssertions** for fluent style | **Do NOT add FluentAssertions v8+** for commercial work unless licensing has been explicitly approved: it became a **commercial, paid-per-seat license** in January 2025 (≈ $129.95/seat). Projects still on FluentAssertions v7 (Apache 2.0) **MUST** pin the version to `[7.*]` in the `.csproj` to avoid an inadvertent license breach on update; prefer migrating to a free alternative. |
| Coverage | **coverlet** via `dotnet test --collect:"XPlat Code Coverage"` | Report in CI; enforce the diff floor from [§4](#4-coverage-and-quality-gates). |

> **NSubstitute** and the assertion choice are not stylistic preferences — they keep the organization clear of known licensing, privacy, and supply-chain trust risks (the FluentAssertions and Moq/SponsorLink landmines). Treat them as compliance items, not opinions.

### 6.2 The unit/integration boundary

In .NET the boundary is **not** the tool (both tiers use xUnit) — it is *what the test touches*. If a test validates wiring, configuration, the database, serialization, or the HTTP pipeline, it is an **integration** test. If it exercises one class with its collaborators substituted, it is a **unit** test.

### 6.3 Unit tests

```csharp
public class SlotSwapServiceTests
{
    [Fact]
    public async Task Swap_WhenTargetSlotIsCold_WarmsUpBeforeSwapping()
    {
        // Arrange
        var warmup = Substitute.For<IWarmupClient>();
        warmup.IsWarmAsync("staging").Returns(false);
        var sut = new SlotSwapService(warmup, Substitute.For<ISlotClient>());

        // Act
        await sut.SwapAsync(source: "staging", target: "production");

        // Assert
        await warmup.Received(1).WarmAsync("staging");
    }
}
```

- Substitute *all* out-of-process dependencies. A unit test **MUST NOT** open a socket, touch the filesystem, or hit a database.
- Inject `TimeProvider` (or an `IClock` abstraction) instead of calling `DateTime.Now`.

### 6.4 Integration tests

Integration tests **MUST** run against the real ASP.NET Core pipeline via `WebApplicationFactory<TEntryPoint>`, and against provisioned test infrastructure — never an in-memory database provider (see [§8](#8-data-layer--azure-sql--entity-framework-core)).

```csharp
public sealed class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _connectionString =
        Environment.GetEnvironmentVariable("ConnectionStrings__IntegrationTestDb")
        ?? throw new InvalidOperationException("Set ConnectionStrings__IntegrationTestDb.");

    public async ValueTask InitializeAsync()
    {
        using var scope = Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.MigrateAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Inject the environment's test database connection string.
        builder.ConfigureServices(services =>
        {
            services.RemoveAll<DbContextOptions<AppDbContext>>();
            services.AddDbContext<AppDbContext>(o => o.UseSqlServer(_connectionString));
        });
    }
}
```

- Implement `IAsyncLifetime` on the factory (or a shared fixture) to apply migrations once per run and perform any shared setup. Database state **MUST** still be reset between tests ([§8](#8-data-layer--azure-sql--entity-framework-core)). Suites that run heavily in parallel **MAY** use one database or schema per test collection or worker when that is required for reliable isolation.
- **MUST NOT** hardcode connection strings. Read them from CI secrets, developer secrets, or environment variables and inject via `ConfigureWebHost`.

---

## 7. Frontend — Angular / Tailwind CSS

This section refines, for testing, the rules in `angular.md`.

### 7.1 Runner

- New Angular projects **MUST** use **Vitest**, which is the Angular CLI's default unit-test runner as of 2026 (with `jsdom` simulating the DOM). It is markedly faster than Karma and has a stronger mocking model.
- Karma + Jasmine is **deprecated** but still supported. Existing Karma suites **MAY** remain; new suites **MUST** be Vitest, and migration **SHOULD** be scheduled when a project is otherwise being modernized.
- When using Vitest, avoid relying on Zone.js-specific patterns such as `fakeAsync` unless the project has explicitly configured the supported compatibility patch. Prefer `async` / `await`, `userEvent`, and observable DOM assertions.

### 7.2 Component tests — query like a user

- Component tests **SHOULD** use **Angular Testing Library** and query through **accessible queries**, in this preference order: `getByRole` → `getByLabelText` → `getByText` → (last resort) `getByTestId`. `getByRole` is the top preference for almost everything.
- For Angular Material and other CDK-based widgets, use **Component Harnesses** (`@angular/cdk/testing`). Harnesses interact with a widget the way a user does and insulate the test from the widget's internal DOM, so implementation changes do not break tests.

```typescript
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

it('should disable submit until the form is valid', async () => {
  await render(BidFormComponent);

  const submit = screen.getByRole('button', { name: /submit bid/i });
  expect(submit).toBeDisabled();

  await userEvent.type(screen.getByLabelText(/price/i), '4.25');
  expect(submit).toBeEnabled();
});
```

### 7.3 Signals, services, and HTTP

- Test signal-based state by asserting the **rendered result** of a signal change, not the signal's internal value — keep to observable behavior.
- Test HTTP-calling services with `provideHttpClientTesting` and `HttpTestingController`; assert the request shape and feed deterministic responses. Never let a component test reach the network.

### 7.4 Do NOT test styling or implementation details

- Tests **MUST NOT** assert on **Tailwind CSS class names** (for example, `expect(el.className).toContain('bg-green-700')`). Utility classes are implementation detail; asserting on them creates brittle tests that break on harmless restyling and verify nothing about behavior.
- Verify *visible behavior and accessibility* (text, roles, enabled/disabled, ARIA state) instead. For intentional visual correctness, use a dedicated **visual regression** tool (for example, Playwright screenshot comparison), not class-name assertions.
- Add stable `data-testid` attributes only where an accessible query genuinely cannot reach an element — they are an escape hatch, not the default.

---

## 8. Data Layer — Azure SQL / Entity Framework Core

The application database is **Azure SQL**, accessed through **Entity Framework Core** (an object-relational mapper, or ORM). Database tests are where our most expensive defects hide, so they get the strictest rules. This section pairs with `sql.md`.

- Integration tests that touch data **MUST** run against a **real Azure SQL test database** or another explicitly approved SQL Server-family test database, because database behavior, constraints, transactions, query translation, and migrations are part of what the test is verifying.
- Tests **MUST NOT** use the EF Core **in-memory provider** or `EnsureCreated()` for behavior that depends on the database engine. The in-memory provider does not enforce relational constraints, foreign keys (FKs), or real SQL semantics, so it produces false confidence — a missing `.Include()` that returns `null` in production passes silently against in-memory.
- Schema **MUST** be created by running the **real EF Core migrations** in test setup (`dbContext.Database.Migrate()`), never `EnsureCreated()`. This means a broken migration fails the test suite before it fails production.
- Between tests, reset state with **Respawn** (preferred for speed) or by wrapping each test in a transaction that rolls back. Each test **MUST** start from a known, clean database state.
- **Azure SQL parity:** Pull-request gates **SHOULD** use a dedicated Azure SQL test database when the application production database is Azure SQL. A local or shared SQL Server-family database **MAY** be used for fast developer feedback, but release validation **MUST** include the Azure SQL-backed integration suite.

```csharp
// Respawn resets the provisioned test database between tests.
private static readonly string ConnectionString =
    Environment.GetEnvironmentVariable("ConnectionStrings__IntegrationTestDb")
    ?? throw new InvalidOperationException("Set ConnectionStrings__IntegrationTestDb.");

public async Task ResetAsync()
{
    using var conn = new SqlConnection(ConnectionString);
    await conn.OpenAsync();
    var respawner = await Respawner.CreateAsync(conn,
        new RespawnerOptions { DbAdapter = DbAdapter.SqlServer });
    await respawner.ResetAsync(conn);
}
```

---

## 9. Regression Testing

Regression testing is not a separate suite to write from scratch — it is a **discipline applied to the tiers above**.

- Every fixed defect **MUST** ship with a test that **fails before the fix and passes after**. That test *is* the regression test; it lives in whichever tier reproduces the bug most cheaply (usually unit or integration).
- The full unit + integration suite **MUST** run on every pull request, so it is by construction the regression safety net — no separate "regression run" is maintained.
- For the user interface, intentional visual regressions are caught by **visual regression** snapshots in the E2E layer, not by asserting markup or classes.

---

## 10. End-to-End — Playwright

- E2E tests **MUST** use **Playwright** (cross-browser, auto-waiting, network interception). Protractor is dead; Cypress is acceptable only on legacy suites already using it.
- Tests **MUST** select elements by **role / accessible name** or stable **`data-test`** attributes — **never** by Tailwind classes or auto-generated IDs.
- Organize flows with the **Page Object Model (POM)** — a pattern that encapsulates each page's selectors and actions behind a small API, keeping tests readable and resilient.
- Decide deliberately between **mocking** the backend (fast, deterministic, for UI-logic flows) and running against a **real staged backend** (for true end-to-end confidence). Critical money/trade paths **SHOULD** have at least one real-backend E2E test.
- E2E **SHOULD** run against a **deployment slot** (see [§11](#11-deployment-validation--azure-app-service)) before the slot is swapped to production, so the exact build that will go live is the build that was tested.

---

## 11. Deployment Validation — Azure App Service

Deployment to **Azure App Service** uses **deployment slots** for zero-downtime, blue-green releases. The slot is where automated validation meets the running system. This section pairs with the deployment rules in `security.md` and `logging.md`.

### 11.1 Health-check endpoint contract

- The application **MUST** expose separate health semantics for **liveness** and **readiness**:
  - **Liveness** answers "is this process running and able to respond?"
  - **Readiness** answers "is this instance ready to serve real traffic?", including that critical dependencies (Azure SQL, cache, queue, identity provider) are reachable.
- Deployment validation and pre-swap smoke tests **MUST** use the **readiness** endpoint. It returns an HTTP status in the **200–299** range only when the instance is genuinely ready to serve traffic, and a failure status when any critical dependency is down.
- Configure App Service **Health check** deliberately. If the endpoint is used to remove or replace instances, do not point it at an overly strict dependency-readiness check unless that is the intended production behavior. Validate the chosen endpoint in a **staging slot** before enabling it in production.

### 11.2 Slot swap, warm-up, and smoke tests

The release sequence **MUST** be:

1. CI/CD (continuous integration / continuous delivery) deploys the build to the **staging slot**.
2. The slot is **warmed up** — configure `WEBSITE_SWAP_WARMUP_PING_PATH` and `WEBSITE_SWAP_WARMUP_PING_STATUSES` so every instance is hot before the swap eliminates downtime.
3. **Smoke tests** run against the staging slot: the health endpoint plus a small set of critical-path checks (can a user sign in; can a representative read and write succeed). Application Insights is checked for new failures.
4. Only on green does the pipeline **swap** staging into production. Prefer **swap with preview** so the app is exercised against production settings before the final swap.

- A deployment **MUST NOT** be swapped to production while smoke tests are red or health is failing on the staging slot.
- Smoke tests are intentionally **small and fast** — they answer "is it alive and serving?", not "is every feature correct?" (that is the job of the earlier tiers).

---

## 12. Performance and Load Testing

- Performance-sensitive endpoints **SHOULD** have a baseline scenario in **k6** or **NBomber**, run against a staging slot, with latency and throughput thresholds that fail the run when breached.
- Performance tests **SHOULD NOT** gate every pull request (too slow, too noisy); run them pre-release or nightly and track trends, alerting on regressions.
- Pair load results with the observability dashboards described in `logging.md` (speed-to-render, concurrent users, per-application errors, 95th/99th-percentile availability).

---

## 13. CI/CD Integration — Where Each Tier Runs

| Stage | Tiers run | Gate |
|---|---|---|
| Pre-commit / inner loop | Unit, component | Developer's machine; fast |
| Pull request | Static analysis, unit, component, integration | **Blocks merge** on failure or below-floor diff coverage |
| Pre-deploy (to staging slot) | E2E against the slot | Blocks the swap |
| Post-deploy (staging slot) | Smoke, health | Blocks the swap to production |
| Nightly / scheduled | Performance/load, full E2E matrix, Azure SQL parity run | Alerts; tracked, not merge-blocking |

- Test execution time **SHOULD** be optimized once a suite grows large enough to slow the inner loop. Prefer reliable first steps: parallel execution, test splitting, dependency caching, and eliminating avoidable application startup. **Test impact analysis** (running only the tests affected by a diff) **MAY** be used when the CI platform can prove accurate dependency mapping for the repository's languages and runners.

---

## 14. Anti-Patterns (Quick Reference)

| Anti-pattern | Why it's wrong | Do instead |
|---|---|---|
| Asserting on Tailwind class names | Brittle; tests styling, not behavior | Query by role/text; visual regression for looks |
| EF Core in-memory provider / `EnsureCreated()` for DB tests | False confidence; no real SQL semantics | Dedicated SQL test database + run real migrations |
| Auto-retrying flaky tests to green | Hides concurrency bugs; erodes trust in CI | Use retries only for diagnosis; quarantine, ticket, fix at source, replace, or delete |
| Adding FluentAssertions v8+ without approval | Commercial use requires a paid license | Shouldly / AwesomeAssertions / xUnit `Assert` |
| New Moq usage | SponsorLink supply-chain/privacy trust risk | NSubstitute |
| Coverage as a target to maximize | Produces assertion-free tests | Coverage as a floor to find untested code |
| Logic (`if`/`for`) inside a test | Untested test logic; unclear failures | Parameterized/`[Theory]` cases |
| Shared mutable state between tests | Order-dependent, flaky | Each test arranges and resets its own world |
| `DateTime.Now` / real randomness in tests | Non-deterministic | Inject `TimeProvider` / seeded randomness |
| Selecting E2E elements by generated ID/class | Breaks on refactor | `data-test` attributes or accessible role/name |

---

## Glossary

| Term / acronym | Expansion / definition |
|---|---|
| **AAA** | Arrange–Act–Assert — the three-phase structure of a well-formed test. |
| **ARIA** | Accessible Rich Internet Applications — attributes conveying UI semantics to assistive technology. |
| **CDK** | Component Dev Kit — Angular's library of behavior primitives, including test harnesses. |
| **CI / CD** | Continuous integration / continuous delivery (or deployment) — the automated build-test-release pipeline. |
| **DOM** | Document Object Model — the in-memory tree representing a rendered page. |
| **E2E** | End-to-end — a test driving the whole application as a user does. |
| **EF Core** | Entity Framework Core — the .NET object-relational mapper used for Azure SQL access. |
| **FK** | Foreign key — a relational constraint linking rows across tables. |
| **ORM** | Object-relational mapper — a library mapping database rows to objects (here, EF Core). |
| **POM** | Page Object Model — an E2E pattern encapsulating a page's selectors and actions behind an API. |
| **RFC 2119** | The specification defining MUST / SHOULD / MAY normative keywords. |
| **UAT** | User acceptance testing — manual business validation of a running app; **out of scope** for this guide. |
| **Visual regression** | Comparing screenshots across builds to catch unintended visual changes. |

---

## Reference Style Guides

This guide builds upon and references:

- **[xUnit documentation](https://xunit.net/)** — backend test framework.
- **[ASP.NET Core integration tests (Microsoft Learn)](https://learn.microsoft.com/en-us/aspnet/core/test/integration-tests)** — `WebApplicationFactory` patterns.
- **[Testing against your production database system (EF Core, Microsoft Learn)](https://learn.microsoft.com/en-us/ef/core/testing/testing-with-the-database)** — why to test on a real engine.
- **[Angular testing guide](https://angular.dev/guide/testing)** and **[Migrating to Vitest](https://angular.dev/guide/testing/migrating-to-vitest)** — frontend runner and patterns.
- **[Angular component harnesses](https://angular.dev/guide/testing/using-component-harnesses)** — harness-based component testing.
- **[Testing Library](https://testing-library.com/)** — accessible-query philosophy.
- **[Playwright](https://playwright.dev/)** — end-to-end testing.
- **[Azure App Service deployment best practices (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/app-service/deploy-best-practices)** and **[staging slots](https://learn.microsoft.com/en-us/azure/app-service/deploy-staging-slots)** — slot swap, warm-up, smoke tests, health checks.

### Sibling guides in this repository

- `csharp.md` — C# / .NET conventions (this guide refines its testing rules).
- `angular.md` — Angular / Tailwind conventions.
- `sql.md` — Azure SQL schema and query standards.
- `error-handling.md` — the error contract that contract tests verify.
- `logging.md` — observability and the dashboards that pair with performance tests.
- `security.md` — deployment and authorization rules that smoke/E2E tests exercise.
