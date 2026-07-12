# Maps — Path to Production

Everything required to move the mapping features out of proof-of-concept state into a properly
supported part of the app and the Azure environment. This consolidates the "deferred / future /
open questions" items scattered across the original design docs, plus items surfaced by reviewing
the code as built.

Nothing here is a research problem — these are known, scoped steps. Items are grouped and marked
with a rough **must-do-before-shipping** vs. **enhancement** signal.

## Table of Contents

- [Blocking items (required before any shared-environment deployment)](#blocking-items-required-before-any-shared-environment-deployment)
  - [Database: real EF migration on Azure SQL](#database-real-ef-migration-on-azure-sql)
  - [Secrets: move keys to Azure Key Vault](#secrets-move-keys-to-azure-key-vault)
  - [Vendor key exposure: server-side proxy](#vendor-key-exposure-server-side-proxy)
  - [Vendor licensing: paid LandMapMagic + Azure Maps tier](#vendor-licensing-paid-landmapmagic--azure-maps-tier)
  - [Network: outbound NSG rule for the vendor host](#network-outbound-nsg-rule-for-the-vendor-host)
  - [Bid Sheet engine decision (Leaflet vs. MapLibre)](#bid-sheet-engine-decision-leaflet-vs-maplibre)
  - [Testing](#testing)
  - [Security / compliance review + change management](#security--compliance-review--change-management)
  - [SBOM and dependency baselining](#sbom-and-dependency-baselining)
- [Enhancements (revisit only once the above is done)](#enhancements-revisit-only-once-the-above-is-done)
- [Traceability: where each item came from](#traceability-where-each-item-came-from)

## Blocking items (required before any shared-environment deployment)

### Database: real EF migration on Azure SQL

Today the `CustomerFieldTag` data lives in a **local SQLite file** through a separate
`FieldTagDbContext`, created with `EnsureCreated()` and deliberately never migrated into the
shared database. To productionize:

- Add `CustomerFieldTag` to the app's real `ApplicationDbContext` (against Azure SQL), with a
  proper **EF Core migration** — not `EnsureCreated()`.
- Recreate the constraints in T-SQL: the non-unique index on `CustomerId`, and the **unique
  filtered index** on `(CustomerId, ExternalRef)` with filter `[IsDeleted] = 0` (SQL Server bracket
  quoting, not SQLite's `"IsDeleted" = 0`).
- Reconcile types now that the entity shares a database with `Customer`: decide whether to add a
  real FK/navigation to `Customer` (the POC has none, because the tables lived in different
  databases). `CustomerId` is `long` (bigint), matching the rest of the app.
- Retire `FieldTagDbContext`, `FieldTagsPocDependencyInjection.cs`, the SQLite package
  (`Microsoft.EntityFrameworkCore.Sqlite` + the pinned `SQLitePCLRaw.lib.e_sqlite3`), and the
  `FieldTags:LocalStorePath` gate. Repoint `FieldTagRepository` at `ApplicationDbContext`.
- Remove the SQLite-specific workarounds: in-memory decimal summation in apply-calculated-acres
  (SQL Server can translate `SumAsync`), and the SQLite filtered-index quoting.
- The workflow identity already has `db_ddladmin` on Origination, so migrations run in CI (see
  `developer-docs/CLAUDE.md` → GitHub Actions / SQL migrations).

### Secrets: move keys to Azure Key Vault

`FieldTags:AzureMapsKey` and `FieldTags:LandMapMagicKey` are in local `dotnet user-secrets` today.
Move both to **Azure Key Vault** per this repo's existing convention — the API already boots Key
Vault config via `Azure.Extensions.AspNetCore.Configuration.Secrets` and reads
`Configuration["KeyVaultUri"]` with a managed identity (see `developer-docs/CLAUDE.md` → Key
Vault). Because the config keys are read by name, this is **zero code change** once the secrets
exist in the vault (`kv-orig-dev-eus` / `-qa-eus` / `-eus`). Do the same for `FieldTags:CdlYear`/
`FieldTags:CdlFallbackYear` or leave them in appsettings (non-secret). Consider renaming the
`FieldTags:*` section to a neutral `Maps:*` now that two features read it (cosmetic, optional).

### Vendor key exposure: server-side proxy

LandMapMagic is currently called **client-direct from the browser** — the SPA fetches the vendor
key from `/api/field-tag-config` or `/api/map-config` and uses it in browser-side `fetch()` calls
(tiles, styles, point lookup, AOI). The key is therefore visible in the browser. For production,
move these calls behind a **server-side proxy** so the vendor key never reaches the client:

- The plain-`fetch` service modules (`lmm-point-lookup`, `lmm-aoi-query`, and the tile/style URL
  builders) would point at a new backend endpoint instead of `api.landmapmagic.com` directly.
- This also centralizes vendor-call rate limiting, caching (see the AOI-caching enhancement), and
  usage metering server-side.
- Note the network constraint below — a server-side proxy is also what makes the outbound NSG rule
  tractable (one server egress path instead of every client).

### Vendor licensing: paid LandMapMagic + Azure Maps tier

- **LandMapMagic**: the POC uses a **free-tier personal account** under an individual Scoular
  contact. Production requires a proper **paid business license** and a review of its terms
  (especially around client-direct vs. proxied use, and per-query/token pricing at real volume).
  The per-feature usage-tracking events already emitted (`field-context-lookup`, field-tagging AOI
  confirms) give empirical volume data to size the license.
- **Azure Maps**: confirm the current subscription/tier is sized for production tile + geocoding
  traffic, and that its licensing covers this usage. The POC reuses an existing key.

### Network: outbound NSG rule for the vendor host

Deployed environments use a **zero-trust outbound NSG** that denies internet traffic by default
(see `developer-docs/CLAUDE.md` → Network Access). `api.landmapmagic.com` (and any Azure Maps host
not already reached via a private endpoint) needs an explicit `networking.customOutboundRules`
entry in `app-config.json`. This applies whether calls stay client-direct or move to a server-side
proxy — the proxy is a single, auditable egress path (another reason to prefer it). Locally,
internet access is available, which is why the POC "just works" on a dev machine.

### Bid Sheet engine decision (Leaflet vs. MapLibre)

The Bid Sheet keeps **both** map engines mounted permanently behind a runtime `mapEngine` toggle
(`bidSheetMapLibreDefault: true` everywhere, so MapLibre is the default). This was a deliberate A/B
comparison capability, **not** a temporary migration window. Before further Bid Sheet map work
ships, the team must **pick one path and remove the other** — the losing engine's code, its
dependencies (`leaflet` + `leaflet.markercluster` if MapLibre wins), the `angular.json`
script/style entries, and the toggle UI itself. Until then the bundle carries both, which is an
accepted tradeoff, not a bug.

### Testing

- **End-to-end / browser tests are absent.** The app requires real Azure AD login with no dev-mode
  bypass, so none of this POC could be exercised by automated browser tooling. A **test-auth path**
  (or a mocked-auth harness) plus **Playwright** e2e coverage should exist before this ships
  broadly. (`@playwright/test` is already a dev dependency; the harness/auth bypass is not built.)
- **Backend unit coverage is partial.** `FieldTagServiceTests` covers the field-tag service layer
  (validation, dedup, apply-acres). **Missing:** controller-level tests for `FieldTagsController`,
  and any test for `MapConfigController` (its per-key independent gating is exactly the kind of
  logic worth a test), `FieldTagConfigController`, and `GeocodeController`. Add these to
  `api/GrainOriginatorPortal.Api.Tests`.
- Add the field-tagging map's "**zero vendor calls in review mode**" guarantee as an automated
  assertion (spy on `fetch`), and the Bid Sheet's "**no AOI call until an explicit pin action**"
  guarantee likewise — both are currently only manual-checklist items.

### Security / compliance review + change management

Per the org's standard process (Scoular security guidelines / `SECURITY_STANDARDS.md`), any
production rollout of a **new external vendor integration** must go through:

- A formal **security review** — covering the browser-exposed vendor key (resolved by the proxy
  item above), the new outbound network destination, the accepted "no new ACL — field tags share
  the Customer Profile's visibility" posture, and data classification of stored geometry/CDL data.
- The org's standard **ServiceNow change request** and peer review before deployment.
- Confirm no PII/secret is logged (the code already avoids logging geometry/CDL bodies and key
  material — keep it that way).

### SBOM and dependency baselining

The POC added client dependencies (`maplibre-gl`, `@mapbox/mapbox-gl-draw`, `polygon-clipping`,
`@types/mapbox__mapbox-gl-draw`) and a backend one (`Microsoft.EntityFrameworkCore.Sqlite`, which
should be **removed** per the DB item above). On promotion, finalize the SBOM tables in
`README.md` (root) per org policy, run CVE checks, and decide whether to advance `maplibre-gl` off
the v4.7.1 pin (v5 exists; the pin exists to match the validated reference — re-validate the
style-merge/glyph/promoteId behaviors on any major upgrade). A new external service
(**LandMapMagic**) should also get an entry in the integrations/security-model docs under
`docs/application-context/`.

## Enhancements (revisit only once the above is done)

These are recorded in the design docs as intentionally-deferred; none block shipping:

- **Unify Bid Sheet locations with saved geometry.** Bid Sheet locations are still bare lat/lng
  points (no persisted field/parcel geometry), unlike Customer Profile's `CustomerFieldTag`
  records. A future pass could let a bid location carry a real tagged boundary the same way,
  unifying both features on a shared "tagged geometry" model (needs schema work + migration for
  existing point-only rows, which stay valid).
- **AOI / vendor-call caching.** Bid Sheet fetches field context strictly per explicit action,
  never cached. A future enhancement would cache each pin's AOI result (keyed by coordinate or
  location id) so previously-looked-up pins show context in bulk, with an explicit re-fetch to
  refresh — needs its own token-budget conversation and a staleness policy (CDL is annual).
- **User-editable field "Label" nickname** on `CustomerFieldTag` (nullable column + inline rename
  + PATCH endpoint; auto-generated label as fallback).
- **CDL year-refresh action** — re-run the AOI query on an existing tag to refresh its stored
  CDL year/snapshot to a newer vintage.
- **Tier 3 / ML-derived boundaries** — never built (the vendor had no such tier in the reference).
- **Multi-customer / linked-producer field views** — linked producers keep their own tags; no
  cross-link aggregation today.
- **CLU multiselect UX** — the reliable native id enables a toggle-several-then-confirm selection
  flow; an interaction polish, not a change to the immediate-persist contract.

## Traceability: where each item came from

| Item | Source in the design docs |
|---|---|
| Real EF migration on Azure SQL; retire SQLite/`FieldTagDbContext` | `field-tagging/00-overview.md` (deferred), `01-data-model.md`, `06-sequencing-and-open-items.md` (promotion checklist) |
| Keys → Key Vault | `field-tagging/00-overview.md` (key-storage phases), `05-local-dev-setup.md` (phasing table) |
| Server-side proxy for vendor calls | `field-tagging/00-overview.md` (intentionally deferred), `05-local-dev-setup.md` |
| Paid LandMapMagic license; Azure Maps tier | `field-tagging/00-overview.md`, `05-local-dev-setup.md`, `06-sequencing-and-open-items.md` |
| Bid Sheet engine decision / retire the loser | `bid-sheet/00-overview.md` (settled decisions 10-11), `03-frontend-components.md`, `04-sequencing-and-rollout.md` |
| Bid Sheet locations → saved geometry; AOI caching | `bid-sheet/00-overview.md` → Future enhancements |
| SBOM / dependency baselining; `maplibre-gl` v5 | `field-tagging/00-overview.md`, `06-sequencing-and-open-items.md` |
| Security review + ServiceNow change management | `field-tagging/06-sequencing-and-open-items.md` (promotion checklist); org security policy |
| Label nickname, CDL refresh, Tier 3, multi-customer | `field-tagging/00-overview.md`, `04-frontend-list-and-hover-sync.md`, `06-sequencing-and-open-items.md` |
| Testing / e2e / auth bypass; outbound NSG rule | Code review (as-built) + `developer-docs/CLAUDE.md` (network, CI) |
