# Field Tagging POC — Backend API

## Table of Contents

- [Patterns to mirror (verified in repo)](#patterns-to-mirror-verified-in-repo)
- [Route design and reasoning](#route-design-and-reasoning)
- [Layering: controller → service → repository](#layering-controller--service--repository)
- [Endpoints](#endpoints)
  - [GET field-tags](#get-apicustomerscustomeridfield-tags)
  - [POST field-tags](#post-apicustomerscustomeridfield-tags)
  - [DELETE field-tag](#delete-apicustomerscustomeridfield-tagsid)
  - [POST apply-calculated-acres](#post-apicustomerscustomeridfield-tagsapply-calculated-acres)
  - [GET field-tag-config](#get-apifield-tag-config)
- [Validation rules](#validation-rules)
- [Error responses](#error-responses)
- [Authorization](#authorization)
- [Logging](#logging)

## Patterns to mirror (verified in repo)

The new backend code copies the shape of these actual files:

- **Controller pattern** — `api/GrainOriginatorPortal.Api/Controllers/NotesController.cs`:
  `[ApiController]`, `[Authorize]`, `[Produces("application/json")]`, constructor-injected
  service interface + `ILogger`, `[ProducesResponseType]` on every action,
  `CancellationToken cancellationToken = default` as the last parameter, thin actions that
  delegate to the service, `Created($"/api/...", dto)` on POST, `NoContent()` on DELETE, and an
  audit `LogInformation` with `[{ErrorCode}] [{ErrorCategory}]` structured tokens
  (`AUDIT_CREATE` / `AUDIT_UPDATE` / `AUDIT_DELETE`, category `DataMutation`) after each mutation.
- **Customer-scoped reads** — `ProducerDetailsController.cs` (`customer/{customerId:long}` route
  segments, `long` ids).
- **Service pattern** — `api/GrainOriginatorPortal.Api/Services/NoteService.cs`: interface +
  implementation pair in `Services/`, repository injected from Infrastructure,
  `IRequestContextService.GetCurrentUser()` supplies the audit identity, entity→DTO mapping in
  `Services/Mappings/` (see `ProducerDetailsMappings.cs` for the extension-method mapping style).
- **Repository pattern** — `api/GrainOriginatorPortal.Infrastructure/Repositories/NoteRepository.cs`:
  scoped class over the DbContext, `AsNoTracking()` reads, `!IsDeleted` filters, soft delete sets
  `IsDeleted/DeletedAt/DeletedBy`, `DateTime.UtcNow` timestamps, `ILogger` breadcrumbs.
- **Request/response DTOs** — records in `api/GrainOriginatorPortal.Api/Models/Requests/` and
  `Models/Responses/` (e.g. `CreateNoteRequest.cs`, `NoteResponse.cs`).
- **Errors** — exceptions from `api/GrainOriginatorPortal.Api/Exceptions/` handled centrally by
  `Middleware/GlobalExceptionHandler.cs` into the `ApiErrorResponse` envelope
  (`Models/Responses/ApiErrorResponse.cs`). `BusinessException` maps to its `HttpStatusCode`
  (default **409**) — exactly what the duplicate-tag case needs. `ValidationException` → 400 with
  field details, `NotFoundException` → 404.

## Route design and reasoning

New controller: `api/GrainOriginatorPortal.Api/Controllers/FieldTagsController.cs`
(**new file, does not yet exist**), with the explicit route attribute
`api/customers/{customerId:long}/field-tags`.

Two deliberate notes:

1. **Deviation from `[Route("api/[controller]")]`**: the repo convention would suggest
   `api/fieldtags` + `customer/{customerId:long}` sub-routes. The customer-nested route was a
   settled decision and is kept: every operation on a tag is intrinsically customer-scoped (the
   dedup index is per-customer, the acres action is per-customer), and putting `customerId` in the
   route prefix makes that impossible to forget on any action. ASP.NET Core routing handles a
   literal-prefixed template on a separate controller fine — `CustomersController`
   (`api/customers`) is not touched and cannot conflict because none of its routes have a
   `/field-tags` suffix.
2. **The acres action is customer-level, not per-tag.** The originally sketched
   `POST /field-tags/{id}/apply-calculated-acres` was wrong on its own terms: the action's settled
   semantics are "overwrite `ProducerDetails.TotalAcres` with the SUM of `CalcAcres` across ALL of
   this customer's active tags." A per-tag route would imply per-tag semantics that don't exist
   and would force the handler to ignore its own `{id}`. So the endpoint is
   `POST /api/customers/{customerId}/field-tags/apply-calculated-acres` — the collection-level
   action route.

A second tiny controller, `FieldTagConfigController.cs` (**new file**), route
`api/field-tag-config`, serves the SPA its map keys — see below.

## Layering: controller → service → repository

New files (none exist yet):

| Layer | File |
|---|---|
| Controller | `api/GrainOriginatorPortal.Api/Controllers/FieldTagsController.cs` |
| Controller | `api/GrainOriginatorPortal.Api/Controllers/FieldTagConfigController.cs` |
| Service | `api/GrainOriginatorPortal.Api/Services/IFieldTagService.cs`, `FieldTagService.cs` |
| Mapping | `api/GrainOriginatorPortal.Api/Services/Mappings/FieldTagMappings.cs` |
| Requests | `api/GrainOriginatorPortal.Api/Models/Requests/CreateFieldTagRequest.cs` |
| Responses | `api/GrainOriginatorPortal.Api/Models/Responses/FieldTagResponse.cs`, `ApplyCalculatedAcresResponse.cs`, `FieldTagConfigResponse.cs` |
| Repository | `api/GrainOriginatorPortal.Infrastructure/Interfaces/IFieldTagRepository.cs`, `Repositories/FieldTagRepository.cs` |

The service depends on `IFieldTagRepository`, `IProducerDetailsRepository` (existing — for the
acres write), `ICustomerRepository` (existing — customer-existence check and the
`CustomerName`/`ScoularId` snapshot the ProducerDetails upsert path needs), and
`IRequestContextService` (existing — current user for audit columns).

## Endpoints

### `GET /api/customers/{customerId}/field-tags`

Returns all **active** (non-deleted) tags for the customer, newest first (`CreatedAt` desc, the
`NoteRepository` ordering convention).

Response: `200 OK`, array of `FieldTagResponse`:

| Field | Type | Notes |
|---|---|---|
| `id` | number (int) | |
| `customerId` | number (long) | |
| `selectionMethod` | string | `clu` \| `parcel` \| `drawn` |
| `geometryJson` | string | GeoJSON geometry as stored (client parses it) |
| `calcAcres` | number \| null | |
| `externalRef` | string | Client uses these for the pre-POST duplicate check |
| `cdlYear` | string \| null | |
| `cdlSnapshotJson` | string \| null | Client parses to `CropBreakdownEntry[]` |
| `createdBy` | string | |
| `createdAt` | string (ISO 8601 UTC) | |
| `modifiedBy` | string \| null | |
| `modifiedAt` | string \| null | |

Dormant feature (no `FieldTags:LocalStorePath` configured): returns `200` with an empty array —
read paths degrade silently; the SPA won't show the tab anyway (config endpoint reports
`enabled: false`).

### `POST /api/customers/{customerId}/field-tags`

Creates one tag. Request body `CreateFieldTagRequest`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `selectionMethod` | string | yes | must be `clu` \| `parcel` \| `drawn` |
| `geometryJson` | string | yes | GeoJSON Polygon/MultiPolygon geometry |
| `calcAcres` | number \| null | no | |
| `externalRef` | string | yes | Client-derived per `01-data-model.md` |
| `cdlYear` | string \| null | no | |
| `cdlSnapshotJson` | string \| null | no | |

`customerId` comes from the route only (not the body — no ambiguity). Server sets `CreatedBy`
(from `IRequestContextService`) and `CreatedAt` (UTC). Response: `201 Created` with the full
`FieldTagResponse` and a `Location` of `/api/customers/{customerId}/field-tags/{id}`, mirroring
`NotesController.Create`.

Duplicate handling: the repository checks for an existing active row with the same
`(CustomerId, ExternalRef)` before insert and the service throws
`BusinessException("A tag for this field already exists...", "FIELD_TAG_DUPLICATE")` → 409 via
`GlobalExceptionHandler`. The unique filtered index is the race-condition backstop: catch
`DbUpdateException` wrapping a SQLite unique-constraint violation (SQLite error 19 /
`SqliteException.SqliteErrorCode` 19) and translate it to the same `BusinessException`. The
client normally never hits either (it pre-checks against loaded `externalRef`s), so this is the
documented fallback, not the primary UX.

Dormant feature: `409` with code `FIELD_TAGS_DISABLED` (via `BusinessException`).

### `DELETE /api/customers/{customerId}/field-tags/{id}`

Soft delete, exactly the `NoteRepository.DeleteAsync` pattern: load active row (must also match
`customerId` from the route — a tag id under the wrong customer is a 404), set
`IsDeleted = true`, `DeletedAt = UtcNow`, `DeletedBy = current user`. Response `204 No Content`;
`404` (`NotFoundException("FieldTag", id)`) when no active row matches.

### `POST /api/customers/{customerId}/field-tags/apply-calculated-acres`

No request body. Semantics (exact, settled):

1. Load all active tags for `customerId`; **sum `CalcAcres` in memory** (SQLite provider cannot
   translate decimal `SumAsync` — see `01-data-model.md`). Tags with null `CalcAcres` contribute 0.
2. If the customer has **zero active tags**, reject with `BusinessException` →
   `409 FIELD_TAGS_EMPTY` ("No active field tags to calculate acres from") — writing a 0 over the
   producer's hand-entered acres from an empty state would be pure data loss.
3. Upsert `ProducerDetails` for the customer with `TotalAcres = sum` (rounded to 1 decimal,
   matching the display precision used for acreage throughout the feature), leaving every other
   `ProducerDetails` field untouched. Reuse `IProducerDetailsRepository`'s existing upsert path
   (see `ProducerDetailsService.UpsertAsync`'s signature in
   `api/GrainOriginatorPortal.Api/Services/ProducerDetailsService.cs`) or add a narrow
   `UpdateTotalAcresAsync` on the repository if the full upsert signature proves awkward — the
   narrow method is preferred so the POC can't accidentally clobber `GrainOnFarm`/commodities.
   Note: if no `ProducerDetails` row exists yet, create one (it's a one-row-per-customer upsert
   entity — verified header comment in `ProducerDetails.cs`), resolving
   `CustomerName`/`ScoularId` from `ICustomerRepository` as `NoteRepository.AddAsync` does.
4. Must **NOT** touch `Customer.TotalAcres` (ODS-synced, `int`, nightly `CustomerSyncService`
   would fight it) or `PlantingIntention.Acres` (per-crop-year; no field mapping).

Response `200 OK`, `ApplyCalculatedAcresResponse`:

| Field | Type | Notes |
|---|---|---|
| `customerId` | number | |
| `totalAcres` | number | The value just written |
| `tagCount` | number | Active tags summed |

Audit log: `AUDIT_UPDATE` / `DataMutation` with customerId, tagCount, and totalAcres.

### `GET /api/field-tag-config`

`FieldTagConfigController`, `[Authorize]`d like everything else. Returns the SPA's runtime map
configuration so the vendor/Azure keys never live in a committed Angular file (the repo's
`client/src/environments/environment*.ts` files are all committed — verified — so they are not a
home for secrets; org policy also forbids secrets in environment files). Keys come from
user-secrets via the `FieldTags:*` config section (`01-data-model.md`).

Response `200 OK`, `FieldTagConfigResponse`:

| Field | Type | Notes |
|---|---|---|
| `enabled` | boolean | `FieldTags:LocalStorePath` present AND both keys non-empty |
| `azureMapsKey` | string \| null | null when disabled |
| `landMapMagicKey` | string \| null | null when disabled |
| `cdlYear` | string | default `"2024"` |
| `cdlFallbackYear` | string | default `"2023"` |

The SPA fetches this once per session (on first entry to a customer profile), hides the Fields
tab entirely when `enabled` is false, and uses the keys for its client-direct vendor calls. This
is still the settled "client-direct, browser-visible key" posture — the endpoint changes where
the key is *stored* (user-secrets), not who *calls* the vendor (the browser).

## Validation rules

Enforced in the service (throwing the repo's `ValidationException` for field-level failures):

| Rule | Failure |
|---|---|
| `selectionMethod` ∈ {`clu`,`parcel`,`drawn`} | 400, field `selectionMethod` |
| `geometryJson` parses as JSON and its `type` is `Polygon` or `MultiPolygon` | 400, field `geometryJson` |
| `geometryJson` length ≤ 1 MB | 400 (sanity cap — reconstructed hulls and parcel polygons are a few KB) |
| `externalRef` non-empty, ≤ 80 chars, matches `^drawn:[0-9a-f]{64}$`, `^clu:[0-9]+$` (native MVT feature id — see `01-data-model.md`), or `^parcel:.+$` | 400, field `externalRef` |
| `calcAcres` null or > 0 and < 1,000,000 | 400, field `calcAcres` |
| `cdlYear` null or 4-digit year | 400, field `cdlYear` |
| `cdlSnapshotJson` null or ≤ 256 KB and parses as a JSON array | 400, field `cdlSnapshotJson` |
| Customer exists (via `ICustomerRepository`) | 404, `NotFoundException("Customer", customerId)` |

## Error responses

All errors flow through the existing `GlobalExceptionHandler` into the `ApiErrorResponse`
envelope (`{ error: { code, message, details?, traceId, timestamp, instance } }` — verified in
`Models/Responses/ApiErrorResponse.cs`). New machine codes introduced by this feature:

| Code | HTTP | When |
|---|---|---|
| `FIELD_TAG_DUPLICATE` | 409 | Active tag with same `(customerId, externalRef)` exists |
| `FIELD_TAGS_EMPTY` | 409 | apply-calculated-acres with zero active tags |
| `FIELD_TAGS_DISABLED` | 409 | Mutation attempted while feature unconfigured |
| (standard) `VALIDATION_*` | 400 | Per validation table |
| (standard) not-found | 404 | Unknown customer or tag id |

## Authorization

`[Authorize]` (Azure AD bearer) at controller level — identical to `NotesController` /
`ProducerDetailsController`. **No new ACL, no per-record ownership checks** — settled decision:
field tags share the Customer Profile's visibility. This matches the documented existing posture
("trade units are a UX filter, not an access boundary" comments + `SECURITY-REVIEWS/` AR-01/AR-02
references in those controllers). Mirror the same comment style on the new actions so the next
security review reads it as deliberate.

## Logging

Follow `NotesController`'s audit convention exactly: one `LogInformation` per successful
mutation with `[{ErrorCode}] [{ErrorCategory}]` tokens (`AUDIT_CREATE`/`AUDIT_DELETE`/
`AUDIT_UPDATE`, `DataMutation`), including `TagId`, `CustomerId`, and for creates the
`SelectionMethod`. Never log `GeometryJson`/`CdlSnapshotJson` bodies (noise) or any key material.
