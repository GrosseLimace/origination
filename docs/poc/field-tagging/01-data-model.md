# Field Tagging POC — Data Model & Persistence

## Table of Contents

- [CustomerFieldTag entity](#customerfieldtag-entity)
- [Indexes and constraints](#indexes-and-constraints)
- [ExternalRef derivation (dedup key)](#externalref-derivation-dedup-key)
- [CdlSnapshotJson shape](#cdlsnapshotjson-shape)
- [FieldTagDbContext (new, separate, SQLite)](#fieldtagdbcontext-new-separate-sqlite)
- [Configuration keys](#configuration-keys)
- [NuGet package](#nuget-package)
- [DI registration](#di-registration)
- [SQLite-specific implementation notes](#sqlite-specific-implementation-notes)

## CustomerFieldTag entity

New entity class: `api/GrainOriginatorPortal.Infrastructure/Data/Entities/CustomerFieldTag.cs`
(**new file, does not yet exist**). Follows the audit + soft-delete conventions verified in
`api/GrainOriginatorPortal.Infrastructure/Data/Entities/Note.cs` (audit quartet + soft-delete
trio) and `ProducerDetails.cs` (audit quartet). All timestamps are UTC (`DateTime.UtcNow` at
write time, matching `NoteRepository.cs`).

| Property | CLR type | Nullable | Notes |
|---|---|---|---|
| `Id` | `int` | no | PK, identity (server-assigned). Doubles as the UI hover-sync correlation key (`properties.tagId` on the client) — no separate correlation id exists. |
| `CustomerId` | `long` | no | FK to `dbo.Customer.Id` conceptually — but see note below: **no navigation property / no FK constraint** in the POC, because this table lives in a *different database* (SQLite) than the Customer table. Indexed. |
| `SelectionMethod` | `string` | no | String enum, exactly one of `clu`, `parcel`, `drawn` (matches lcfs-poc `SelectionMethod` in `src/config.ts`). Max length 10. Validate at the API layer; store as plain text. |
| `GeometryJson` | `string` | no | GeoJSON `Polygon` or `MultiPolygon` **geometry object** (not a Feature) serialized as text. Unbounded text column. |
| `CalcAcres` | `decimal?` | yes | Vendor/geodesic calculated acreage. Precision guidance: `decimal(12,2)` semantics; see SQLite notes below. |
| `ExternalRef` | `string` | no | Dedup key — see derivation section. Max length 80 (longest form is `clu:` + 64 hex chars = 68). |
| `CdlYear` | `string?` | yes | CDL vintage actually used, e.g. `"2024"` (the AOI query falls back to `"2023"` — lcfs-poc `aoi-query.ts`). Max length 4. |
| `CdlSnapshotJson` | `string?` | yes | Serialized crop-breakdown array — shape below. Unbounded text. |
| `CreatedBy` | `string` | no | Same convention as `Note.CreatedBy` (populated from `IRequestContextService.GetCurrentUser()` at the service layer, as `NoteService.CreateAsync` does). |
| `CreatedAt` | `DateTime` | no | UTC. |
| `ModifiedBy` | `string?` | yes | Same convention as `Note.ModifiedBy`. |
| `ModifiedAt` | `DateTime?` | yes | UTC. |
| `IsDeleted` | `bool` | no | Soft delete, default false — same trio as `Note`. |
| `DeletedAt` | `DateTime?` | yes | UTC. |
| `DeletedBy` | `string?` | yes | |

**No `Customer` navigation property.** `Note`/`ProducerDetails` carry a `[JsonIgnore] Customer?`
nav populated via `Include()` — that works because they share `ApplicationDbContext` with the
`Customers` DbSet. `CustomerFieldTag` lives in a separate SQLite database, so a nav/`Include()` is
impossible. The service layer resolves customer display data (if ever needed) through the existing
`ICustomerRepository`, not through the field-tag context.

## Indexes and constraints

Configured in `FieldTagDbContext.OnModelCreating` (described in prose here; type it up as EF
fluent configuration):

1. **PK**: `Id`, identity.
2. **Non-unique index** on `CustomerId` (every read path filters by it).
3. **Unique filtered index** on `(CustomerId, ExternalRef)` with filter `IsDeleted = 0`.
   - On SQLite the EF `HasFilter` string must use SQLite quoting/syntax: `"IsDeleted" = 0`
     (SQL Server's `[IsDeleted] = 0` bracket quoting is invalid there).
   - This is what makes "delete tag → re-tag same field" work: the soft-deleted row keeps its
     `ExternalRef` but drops out of the filtered index, so a fresh row can be inserted.
4. String max lengths as in the table above (`SelectionMethod` 10, `ExternalRef` 80, `CdlYear` 4,
   `CreatedBy`/`ModifiedBy`/`DeletedBy` 256 — matching the general audit-column sizing used across
   the app DB).

## ExternalRef derivation (dedup key)

The whole point of `ExternalRef` is: *the same physical field tagged twice for the same customer
must collide*. Derivation is per selection method. The geometry-reconstruction and
winding-normalization building blocks are ported from lcfs-poc; **the hashing step itself is new
work** — lcfs-poc stops at logging an attestation record to the console (`src/attestation.ts`)
and computes no hash. Do not go hunting in lcfs-poc for a hash function; there isn't one.

**Computed client-side** (the browser is the only place that has the reconstruction context — the
loaded vector tiles) and sent in the POST body. The server treats it as an opaque dedup key. That
trust is acceptable for the POC posture (same trust level as the geometry itself).

| Method | `ExternalRef` value |
|---|---|
| `clu` | `clu:` + SHA-256 hex of the canonical serialization of the **reconstructed, winding-normalized, coordinate-rounded full-field geometry** |
| `parcel` | `parcel:` + the vendor's `parcel_id` tile property, verbatim |
| `drawn` | `drawn:` + SHA-256 hex of the canonical serialization of the winding-normalized, coordinate-rounded drawn geometry |

Prefixes keep the three identity domains from ever colliding with each other.

### Why CLU must hash the *reconstructed* geometry

Verified against lcfs-poc source, this is the critical subtlety:

- The vendor's CLU features have **no usable id**. Point-lookup returns `id: "unknown"` for every
  CLU feature (a real API limitation, confirmed across many test points — see the long comment in
  `lcfs-poc/src/api/point-lookup.ts` lines 32–59). The fetched style's `promoteId: "id"` on the
  `clu` source points at a property that doesn't exist, which makes MapLibre assign
  `feature.id = undefined` to every CLU feature (see `lcfs-poc/src/map/landmapmagic.ts`
  `fixSourcePromoteId`). There is no stable vendor identity to use.
- CLU vector tiles **clip each field to its tile**. A field spanning a tile boundary arrives as
  several disjoint fragments. Hashing whichever fragment you happened to click produces a
  different hash depending on viewport/tile context → dedup silently breaks. **Never hash a raw
  tile-clipped fragment.**
- Real identity comes from `calcacres`: every fragment of the same physical field carries an
  identical `properties.calcacres` value. The reconstruction algorithm (lcfs-poc
  `reconstructFullCluGeometry`, `src/main.ts` lines 289–324, restated fully in
  `03-frontend-map-component.md`) collects all loaded fragments sharing the clicked feature's
  `calcacres` via `querySourceFeatures` (no extra API tokens), pools their vertices, takes the
  convex hull (`convexHull` in `src/geo.ts`), and sanity-checks `hullAcres >= calcacres * 0.95`
  before accepting the hull; otherwise it falls back to the single fragment.
- For hashing, prefer the **authoritative CLU geometry returned by the AOI query response**
  (matched back to the clicked field by `calcacres`, exactly as lcfs-poc `confirmSelection` does
  at `main.ts` lines 198–206) — that geometry is viewport-independent, which is even better for
  dedup stability than the hull. The hull is the fallback when the AOI response has no matching
  CLU feature geometry.

### Canonical serialization before hashing

To make the hash deterministic:

1. Normalize winding per RFC 7946 (exterior CCW, holes CW) — port `normalizeWinding` from
   `lcfs-poc/src/geo.ts`.
2. Round every coordinate to **6 decimal places** (~0.11 m — well below any meaningful boundary
   difference, well above float jitter).
3. Serialize as the minimal JSON geometry object `{"type":...,"coordinates":[...]}` with no
   whitespace (standard `JSON.stringify` output order for these two fixed keys).
4. SHA-256 via the browser's `crypto.subtle.digest` (available on `localhost` secure context),
   hex-encoded lowercase.

Document string example: `clu:9f2ac9...64-hex-chars...`.

## CdlSnapshotJson shape

Serialized array of crop-breakdown entries, exactly the client-side shape lcfs-poc derives from
the AOI response (`CropBreakdownEntry` in `lcfs-poc/src/api/aoi-query.ts`):

| Field | Type | Source |
|---|---|---|
| `code` | string | CDL crop code, e.g. `"1"` (Corn) — `properties.crop_code` |
| `crop` | string | Crop display name — `properties.crop_name` |
| `intersectionAcres` | number | `area.intersection_acres` |
| `percentOfAoi` | number or null | `area.percent_of_aoi_in_feature` |

Stored verbatim as the client sends it (camelCase JSON). The backend never parses it; the list UI
reads it back to show the top crop and the expandable breakdown. "Top crop" = the entry with the
largest `intersectionAcres`.

## FieldTagDbContext (new, separate, SQLite)

New file: `api/GrainOriginatorPortal.Infrastructure/Data/FieldTagDbContext.cs`
(**does not yet exist**). Peer of the three existing contexts in that folder
(`ApplicationDbContext.cs`, `OriginationDbContext.cs`, `EntitlementsDbContext.cs` — all verified).

- Single `DbSet<CustomerFieldTag>` named `CustomerFieldTags`, mapped to table `CustomerFieldTags`.
- Model configuration per the Indexes section above.
- **Why a separate context**: `appsettings.Development.json` points `ApplicationDbContext` at the
  shared dev Azure SQL database even for local runs. Adding this entity to `ApplicationDbContext`
  would create migration pressure against a shared database for a throwaway POC. A separate
  context + separate SQLite file means zero migrations, zero shared-DB schema drift, and deleting
  one file resets the POC.
- **Schema creation**: `Database.EnsureCreated()` at startup — *not* migrations. Called once
  during app startup, only when the feature is configured (see DI section). `EnsureCreated()` on
  a dedicated context/database is safe precisely because nothing else shares that database file.

## Configuration keys

All under a `FieldTags` section; the feature is **dormant unless `FieldTags:LocalStorePath` is
present** (the config gate):

| Key | Example | Purpose |
|---|---|---|
| `FieldTags:LocalStorePath` | `.local/fieldtags.db` (relative to API content root) or an absolute path | SQLite file path. Presence of this key activates the whole backend feature (DbContext registration, controllers return data, config endpoint reports `enabled: true`). |
| `FieldTags:AzureMapsKey` | *(secret)* | Azure Maps subscription key, handed to the SPA by the map-config endpoint (`02-backend-api.md`). Store in **user-secrets**, never in appsettings files. |
| `FieldTags:LandMapMagicKey` | *(secret)* | LandMapMagic API key, same handling. |
| `FieldTags:CdlYear` | `2024` | Preferred CDL vintage (mirrors lcfs-poc `CDL_YEAR`). Optional — default `2024`. |
| `FieldTags:CdlFallbackYear` | `2023` | Fallback vintage (mirrors `CDL_FALLBACK_YEAR`). Optional — default `2023`. |

Where they live for local dev: `dotnet user-secrets` in `api/GrainOriginatorPortal.Api` — the
repo's already-documented secrets mechanism (README "Getting Started" step 1). Exact commands in
`05-local-dev-setup.md`. The SQLite file itself must be gitignored (also in `05`).

## NuGet package

| Package | Version | Where |
|---|---|---|
| `Microsoft.EntityFrameworkCore.Sqlite` | **10.0.1** | `api/GrainOriginatorPortal.Infrastructure/GrainOriginatorPortal.Infrastructure.csproj` |

Version pinned to match the repo's existing `Microsoft.EntityFrameworkCore.SqlServer` 10.0.1
(verified in both csproj files) so no EF Core version skew is introduced. It goes in the
**Infrastructure** csproj because that's where the DbContext lives and where the other EF
provider packages already are.

**Branch-only dependency.** This package is a POC artifact on the POC branch; it is not a
permanent dependency signal. Do not update the README SBOM tables for it unless/until the feature
is promoted toward `main` (at which point org SBOM policy applies and the persistence story gets
re-decided anyway — see `06-sequencing-and-open-items.md`). Note that `packages.lock.json` files
exist in both API projects and will change when the package is added — that's expected and stays
on the branch.

## DI registration

Existing wiring, verified: `api/GrainOriginatorPortal.Infrastructure/DependencyInjection.cs`
exposes `AddInfrastructure(IServiceCollection, IConfiguration, bool isDevelopment)`, which
registers the three DbContexts and all repositories; `Program.cs` calls it at line ~200.

What to add (described, not literal code):

1. A new static extension method in the Infrastructure project — suggested name
   `AddFieldTagsPoc(this IServiceCollection, IConfiguration)` — in a **new file**
   `api/GrainOriginatorPortal.Infrastructure/FieldTagsPocDependencyInjection.cs` rather than
   inside `AddInfrastructure`. Rationale: the whole POC unplugs by deleting one file and one
   call-site line; `AddInfrastructure` stays untouched, which keeps the diff reviewable and the
   eventual revert trivial.
2. Inside it: read `FieldTags:LocalStorePath`; if null/empty, **return immediately** (feature
   dormant — no context, no repository registered). Otherwise:
   - Ensure the directory for the path exists (create it — first run on a fresh clone).
   - Register `FieldTagDbContext` via `AddDbContext` with `UseSqlite` and a connection string of
     the form `Data Source={resolved-absolute-path}`. Resolve relative paths against the host
     content root, not the process CWD.
   - Register `IFieldTagRepository` → `FieldTagRepository` (scoped, matching every other
     repository registration in `DependencyInjection.cs`).
3. `Program.cs`: call the new extension right after the existing `AddInfrastructure` call
   (line ~200), and also register the API-layer `IFieldTagService` → `FieldTagService` alongside
   the other service registrations that follow it.
4. **Startup schema creation**: after `builder.Build()`, when the feature is active, create a
   scope, resolve `FieldTagDbContext`, and call `Database.EnsureCreated()`. Guard it behind the
   same config-key check. (An `IHostedService` would also work; the inline-scope approach is
   simpler and this is a POC.)
5. The API-layer service and controller must tolerate the dormant state: cleanest is to have the
   controller/service depend on the repository interface and register a null-object or simply let
   the controller check an injected `IOptions`-style flag and return an empty list / 404 —
   pick the simple route: **when dormant, the service returns empty results and mutation
   endpoints return 409 `FIELD_TAGS_DISABLED`** (details in `02-backend-api.md`). The SPA hides
   the tab when the config endpoint reports `enabled: false`, so these paths are belt-and-braces.

## SQLite-specific implementation notes

Real provider limitations the implementer must design around (these will bite otherwise):

1. **No server-side decimal aggregation.** The EF SQLite provider cannot translate
   `SumAsync(x => x.CalcAcres)` on a `decimal` column (SQLite has no decimal type; EF stores
   decimals as TEXT and throws on ordering/aggregation translation). The
   apply-calculated-acres implementation must **fetch the active rows and sum in memory** —
   trivially fine at field-tag cardinality (tens of rows).
2. **Filtered-index syntax** — `"IsDeleted" = 0`, as noted above.
3. **`EnableRetryOnFailure` is a SQL Server option** — do not copy the SqlServer options block
   from `DependencyInjection.cs`; SQLite needs no retry strategy or command timeout tuning.
4. **File locking**: SQLite allows one writer; with the default pooling and the app's scoped
   contexts this is a non-issue for a single-developer POC, but don't open the file in a second
   tool (DB browser) in write mode while the API runs.
