# Field Tagging POC — Build Sequencing & Open Items

## Table of Contents

- [Recommended build order](#recommended-build-order)
- [Definition of done for the POC](#definition-of-done-for-the-poc)
- [Deferred enhancements (revisit only if the POC proves out)](#deferred-enhancements-revisit-only-if-the-poc-proves-out)
- [Promotion checklist (if the POC graduates)](#promotion-checklist-if-the-poc-graduates)

## Recommended build order

Each step leaves the app runnable and independently verifiable. Estimated grain: half-day to
one-day chunks.

1. **Data model + persistence** (`01-data-model.md`)
   - `CustomerFieldTag` entity, `FieldTagDbContext`, SQLite package, `AddFieldTagsPoc` DI
     extension + `EnsureCreated()` startup hook, config gate, gitignore entry.
   - Verify: API boots with and without `FieldTags:LocalStorePath`; SQLite file materializes
     with the expected table + filtered unique index (inspect with a SQLite browser).
2. **Backend endpoints** (`02-backend-api.md`)
   - Repository → service → `FieldTagsController` + `FieldTagConfigController`, DTOs, mappings,
     validation, 409 paths, audit logging. Unit tests in
     `api/GrainOriginatorPortal.Api.Tests` following the existing xUnit + Moq service-test style.
   - Verify: exercise all five endpoints via `GrainOriginatorPortal.Api.http`-style requests —
     create, list, duplicate-409, delete, re-create after delete, apply-calculated-acres
     (including the zero-tag 409 and the ProducerDetails write).
3. **Map component, review mode** (`03-frontend-map-component.md`)
   - Packages + CSS, `FieldTagMapComponent` with basemap, tagged-fields source/layers, address
     pin, fitBounds rules, hover feature-state, flyTo input. Seed a tag or two via the API by
     hand to have something to render.
   - Verify: renders saved tags; zero LandMapMagic traffic.
4. **Map component, select mode** (`03-frontend-map-component.md`)
   - Style merge + all gotcha fixes (G1–G12), tier selector, point-lookup preview popup, CLU
     reconstruction, AOI confirm, drawn tier, duplicate pre-check, Done.
   - This is the highest-risk step; the gotcha ledger is the review checklist for it.
   - Verify: full tagging flow against the live vendor from a scratch page or the tab shell.
5. **List + parent + hover sync + tab wiring** (`04-frontend-list-and-hover-sync.md`)
   - `CustomerFieldsComponent`, `FieldTagListComponent`, ApiService methods, model interfaces,
     "Fields (N)" tab in `customer-profile.component.ts`/`.html`, use-calculated-acres button,
     toasts, empty state.
   - Verify: two-way hover, click-to-fly, live pill count.
6. **Local-dev polish + full manual pass** (`05-local-dev-setup.md`)
   - Run the entire manual test checklist top to bottom; fix fallout; done.

Dependency note: steps 3–4 only need step 2's GET/POST; if backend and frontend are built by
different people/agents, step 2's contract (the `02` tables) is the interface to freeze first.

## Definition of done for the POC

- Full manual checklist in `05-local-dev-setup.md` passes.
- Feature is invisible (no tab, no errors) on a machine without the local config.
- No changes to `ApplicationDbContext`, no EF migrations, no writes to any shared database
  beyond the existing `ProducerDetails` upsert path.
- Existing Leaflet maps and all other profile tabs behave exactly as on `main`.

## Deferred enhancements (revisit only if the POC proves out)

Recorded once here (details where noted); all are **intentionally not built** now:

| Item | Notes |
|---|---|
| User-editable field "Label" nickname | Spec sketch at the bottom of `04-frontend-list-and-hover-sync.md` |
| CDL year-refresh action | Re-run AOI (10 tokens) on an existing tag to refresh `CdlYear`/`CdlSnapshotJson`; would set `ModifiedBy`/`ModifiedAt` |
| Server-side key proxy | Prod-hardening path; phasing table in `05-local-dev-setup.md` |
| Tier 3 / ML-derived boundaries | Never existed in lcfs-poc either; vendor-dependent |
| Real persistence (Azure SQL + EF migration on `ApplicationDbContext`) | Mandatory before any shared-environment deployment; SQLite store is single-machine by design |
| SBOM + dependency baselining | Org policy applies at promotion time (`00-overview.md`) |
| maplibre-gl v5 upgrade | Port pinned to v4.7.1 for parity with the validated reference; re-validate gotchas G1–G7 on upgrade |
| Multi-customer/linked-producer field views | Linked producers (`Customer.LinkedProducerIds`) each keep their own tags; no aggregation across links in the POC |

## Promotion checklist (if the POC graduates)

Not part of the POC — captured so the exit path is already thought through:

1. EF migration adding `CustomerFieldTags` to the Origination application DB
   (`ApplicationDbContext`), filtered index in T-SQL syntax (`[IsDeleted] = 0`), and retirement
   of `FieldTagDbContext`/SQLite.
2. Keys to dev Key Vault; decide proxy-vs-client-direct with a real (paid) LandMapMagic license
   and its terms.
3. SBOM tables in README + this repo's security-review docs updated (new external service:
   LandMapMagic — needs an entry in the integrations/security model docs under
   `docs/application-context/`).
4. ServiceNow change management + peer/security review per org policy for anything
   production-bound.
