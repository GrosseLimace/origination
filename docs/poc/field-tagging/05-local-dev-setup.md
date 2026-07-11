# Field Tagging POC — Local Dev Setup & Manual Test Checklist

Step-by-step instructions for running the POC locally. Audience: Karl (or a coding agent
implementing from these docs).

## Table of Contents

- [1. Branch](#1-branch)
- [2. Backend keys and config (user-secrets)](#2-backend-keys-and-config-user-secrets)
- [3. Gitignore additions](#3-gitignore-additions)
- [4. Packages](#4-packages)
- [5. Run](#5-run)
- [6. Manual test checklist](#6-manual-test-checklist)
- [7. Resetting the POC data](#7-resetting-the-poc-data)
- [Key-storage phasing (recorded plan)](#key-storage-phasing-recorded-plan)

## 1. Branch

Create a new branch for the POC (instruction for Karl — these docs were written on `main`
without switching):

- Suggested name: `poc/field-tagging`.
- All POC code, the SQLite store, and the branch-only package additions live on this branch.
  Nothing here targets `main` until the POC is judged.

## 2. Backend keys and config (user-secrets)

The repo's documented secrets mechanism is `dotnet user-secrets` in
`api/GrainOriginatorPortal.Api` (README "Getting Started" step 1). The Angular environment files
(`client/src/environments/environment.ts` etc.) are **committed**, so keys must not go there;
instead the SPA pulls keys at runtime from the authenticated `GET /api/field-tag-config`
endpoint (`02-backend-api.md`), which reads these config values:

From `api/GrainOriginatorPortal.Api`, set:

| Secret key | Value |
|---|---|
| `FieldTags:LocalStorePath` | e.g. `.local/fieldtags.db` (activates the feature) |
| `FieldTags:AzureMapsKey` | The **existing lcfs-poc Azure Maps key** — copy it from `/home/khague/ghe/lcfs-poc/.env` (`VITE_AZURE_MAPS_KEY`). Do not provision a new Azure Maps resource for the POC. |
| `FieldTags:LandMapMagicKey` | The free personal LandMapMagic key — same `.env` file (`VITE_LANDMAPMAGIC_API_KEY`) |

(`FieldTags:CdlYear` / `FieldTags:CdlFallbackYear` are optional; defaults 2024/2023.)

Use `dotnet user-secrets set "<key>" "<value>"` for each, matching the README's existing
connection-string example. Nothing key-shaped is ever committed; `appsettings.Development.json`
gets **no** new entries (the `FieldTags` section existing only in user-secrets *is* the local
config gate — CI/dev/QA deployments never define it, so the feature is dormant everywhere but a
configured local machine).

Token budget reminder while testing: each confirmed field costs 10 LandMapMagic tokens (AOI
query) + 1 per preview click (point lookup). Style/tile loads are covered by the vendor's tile
serving. The free tier is fine for a POC test pass; don't leave select mode open while
click-exploring dozens of fields idly.

## 3. Gitignore additions

Add to the root `.gitignore` (verified to exist; it already covers `bin/`, `obj/`,
`client/node_modules/`, etc.):

- `api/GrainOriginatorPortal.Api/.local/` — the SQLite store directory (`fieldtags.db` plus
  SQLite's `-wal`/`-shm` sidecar files, which appear at runtime).

That is the only new ignore needed: keys live in user-secrets (outside the repo tree), and no
gitignored client-side config file exists in this design.

## 4. Packages

Branch-only additions (rationale + versions in `01-data-model.md` / `03-frontend-map-component.md`):

- Backend: `Microsoft.EntityFrameworkCore.Sqlite` **10.0.1** into
  `api/GrainOriginatorPortal.Infrastructure/GrainOriginatorPortal.Infrastructure.csproj`
  (`dotnet add package` with the explicit version; `packages.lock.json` will update — expected).
- Frontend, in `client/`: `maplibre-gl@^4.7.1`, `@mapbox/mapbox-gl-draw@^1.5.1`, and dev
  `@types/mapbox__mapbox-gl-draw@^1.4.9`.
- Add the two CSS files (`maplibre-gl/dist/maplibre-gl.css`,
  `@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css`) to the `styles` array in `client/angular.json`.

Do **not** update the README SBOM tables on the POC branch (deferred deliberately —
`00-overview.md`).

## 5. Run

Standard repo run flow (README):

1. API: `cd api/GrainOriginatorPortal.Api && dotnet run` (http://localhost:5000). First run with
   the feature configured creates the SQLite file via `EnsureCreated()` — check the log line the
   implementer should add ("Field tags POC store initialized at …") and that
   `.local/fieldtags.db` appeared.
2. Client: `cd client && npm install && npm start` (http://localhost:4200).
3. Sign in as usual (MSAL). Open any producer's Customer Profile.
4. Sanity: `GET http://localhost:5000/api/field-tag-config` (with a bearer token — e.g. via the
   SPA's network tab) returns `enabled: true` and both keys.

Pick a test producer whose address geocodes inside row-crop country (CLU coverage is
agricultural; a producer in central Nebraska/Iowa/Kansas gives instant results — CLU tiles render
at zoom ≥ 12 only).

## 6. Manual test checklist

Work through in order; each line is pass/fail.

**Empty state & review mode**

- [ ] Producer with zero tags: "Fields (0)" tab visible (feature enabled); tab shows the
      empty-state panel + map centered on the address pin (zoom ~13), no field polygons.
- [ ] With the feature **not** configured (temporarily clear `FieldTags:LocalStorePath` from
      user-secrets, restart API): the Fields tab does not render at all; no console errors.
      Restore the secret afterwards.
- [ ] Network tab in review mode: **zero** requests to `api.landmapmagic.com`. (Azure Maps tile
      requests are expected.)

**Select mode & tagging (add 2–3 fields across all tiers)**

- [ ] "Add fields" enters select mode: camera flies to address point at zoom 15; CLU outlines
      appear; tier selector shows Tier 1 (CLU, default), Tier 2 (Parcel), Tier 4 (Draw) — no
      Tier 3.
- [ ] Tier 1: hovering a CLU field highlights it (G1/G2/G5 regression check — if CLU hover is
      dead or fields render blank, re-read the gotcha ledger in `03`); clicking shows the popup
      with acreage; Confirm persists (one POST, 201), the field instantly appears in the
      app-styled tagged layer, the vendor highlight clears, picker stays open, list gains a row,
      pill count increments.
- [ ] Pick a CLU field that visibly crosses a tile boundary if you can find one (pan so a field
      is bisected by a render seam): confirmed acreage ≈ the popup's `calcacres`, and the saved
      polygon covers the whole field, not half of it (reconstruction check).
- [ ] Tier 2: parcels become visible (CLU hidden); click + confirm a parcel; row badge reads
      Parcel.
- [ ] Tier 4: draw a polygon (double-click finishes); confirm; row badge reads Drawn; CDL
      breakdown present (or gracefully absent if enrichment failed).
- [ ] Each confirm fired exactly **one** `/data/aoi` request (network tab) and it contains
      `"includeGeometry":true` (camelCase) in the body; CLU confirms include `"clu"` in `layers`;
      parcel/drawn confirms do **not** include `parcels`.
- [ ] "Done" returns to review mode: vendor layers hidden, camera fits all tags + address pin,
      all tagged fields render.

**Persistence guarantee**

- [ ] Hard-refresh the browser (or close/reopen the tab) immediately after confirming a field
      *without* pressing Done: the field is still there after reload. (Every confirm persisted —
      no staged commit to lose.)
- [ ] Restart the API: tags survive (SQLite file, not memory).

**Hover sync & click-to-fly**

- [ ] List row `mouseenter` → matching polygon highlights on the map; `mouseleave` clears it.
- [ ] Hovering a polygon on the map → matching list row gets the highlight class; with a long
      list, an off-screen row scrolls into view.
- [ ] Rapidly waggle the cursor across rows/polygons: no flicker storms or console errors (the
      no-feedback-loop reasoning in `04` holding up in practice).
- [ ] Clicking a row flies/fits the camera to that field; clicking the **same** row again
      re-flies after panning away (the nonce detail in `04`).

**Use calculated acres**

- [ ] Button shows the sum of the tagged fields' acres; click it; success toast appears.
- [ ] `GET /api/producerdetails/customer/{id}` (or the Edit Producer dialog) shows
      `totalAcres` = the sum (1-decimal rounding).
- [ ] The profile header's ODS acres line did **not** change (correct — different field), and the
      producer's `PlantingIntention` records are untouched.
- [ ] Delete one tag, apply again: sum reflects the deletion.
- [ ] Delete ALL tags, apply: request is rejected (409 `FIELD_TAGS_EMPTY`) and the UI disables or
      warns rather than writing 0.

**Duplicate handling**

- [ ] Re-select an already-tagged CLU field (approach it from a different pan/zoom so different
      tiles are loaded): "already tagged" warning fires, no POST (or a 409 if the client check
      was bypassed) — this is the tile-context-independent hash working.
- [ ] Re-select an already-tagged parcel: same warning (parcel_id match).
- [ ] Delete a tag, then re-tag the same field: succeeds (soft-deleted row exits the filtered
      unique index).

**Soft delete**

- [ ] Delete shows a confirm dialog; after confirming, row + polygon disappear, pill count
      decrements.
- [ ] Inspect `fieldtags.db` (any SQLite browser, read-only, API stopped): the row still exists
      with `IsDeleted = 1`, `DeletedAt`/`DeletedBy` populated.

## 7. Resetting the POC data

Stop the API and delete `api/GrainOriginatorPortal.Api/.local/fieldtags.db` (plus `-wal`/`-shm`
files). Next startup re-runs `EnsureCreated()` from scratch. This is the entire disaster-recovery
story, by design.

## Key-storage phasing (recorded plan)

| Phase | Where keys live | Trigger |
|---|---|---|
| Now (POC) | `dotnet user-secrets` on Karl's machine, served to the SPA via authenticated `/api/field-tag-config`; browser-visible thereafter (accepted risk, free personal LandMapMagic account) | — |
| Dev | Azure Key Vault (the API already boots Key Vault config via `Azure.Extensions.AspNetCore.Configuration.Secrets` — same `FieldTags:*` keys, zero code change) | Karl purchases a dev LandMapMagic license |
| Prod | Key Vault + **revisit building the server-side proxy** for vendor calls so the key never reaches the browser | Feature ships beyond dev |
