# Bid Sheet Map Migration — Backend API

## Table of Contents

- [Why a new controller, not reusing `FieldTagConfigController`](#why-a-new-controller-not-reusing-fieldtagconfigcontroller)
- [`MapConfigController` design](#mapconfigcontroller-design)
- [Config keys](#config-keys)
- [`ApiService.getMapConfig()`](#apiservicegetmapconfig)
- [No other backend changes](#no-other-backend-changes)

## Why a new controller, not reusing `FieldTagConfigController`

`api/GrainOriginatorPortal.Api/Controllers/FieldTagConfigController.cs` (existing, field-tagging
only) gates `enabled` on **all three** of `FieldTags:LocalStorePath`, `FieldTags:AzureMapsKey`, and
`FieldTags:LandMapMagicKey` being present — if any one is missing, `AzureMapsKey` and
`LandMapMagicKey` both come back `null` and the SPA hides the Fields tab entirely.

That gating is correct for field-tagging (an all-or-nothing feature) but wrong for Bid Sheet:

- The Bid Sheet basemap must render even if LandMapMagic isn't configured at all — Azure Maps and
  LandMapMagic are independent capabilities for this screen, not a package deal.
- The CLU/Parcel toggle should independently hide itself if only the vendor key is missing, without
  taking the basemap down with it.
- `FieldTags:LocalStorePath` (the field-tagging SQLite gate) has no meaning for Bid Sheet at all and
  must not be part of its gating logic.

Reusing `GET /api/field-tag-config` from Bid Sheet would either wrongly couple the two features'
availability, or require loosening field-tagging's intentionally strict gate — both are worse than
a small new endpoint.

## `MapConfigController` design

New file: `api/GrainOriginatorPortal.Api/Controllers/MapConfigController.cs`.

```csharp
namespace GrainOriginatorPortal.Api.Controllers;

/// <summary>
/// Hands the SPA runtime map configuration for any MapLibre/Azure Maps consumer that isn't
/// field-tagging-specific (currently: Bid Sheet). Unlike FieldTagConfigController, each key is
/// gated independently — the basemap must work even if LandMapMagic isn't configured, and the
/// CLU/Parcel toggle should hide itself on a missing vendor key without affecting the basemap.
/// Keys come from the same FieldTags:* config section (dotnet user-secrets locally / Key Vault
/// when deployed) as field-tagging — no new secret storage, just decoupled exposure.
/// </summary>
[ApiController]
[Route("api/map-config")]
[Authorize]
[Produces("application/json")]
public class MapConfigController : ControllerBase
{
    private readonly IConfiguration _configuration;

    public MapConfigController(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    [HttpGet]
    [ProducesResponseType(typeof(MapConfigResponse), StatusCodes.Status200OK)]
    public ActionResult<MapConfigResponse> Get()
    {
        var azureMapsKey = _configuration["FieldTags:AzureMapsKey"];
        var landMapMagicKey = _configuration["FieldTags:LandMapMagicKey"];

        return Ok(new MapConfigResponse
        {
            AzureMapsKey = string.IsNullOrWhiteSpace(azureMapsKey) ? null : azureMapsKey,
            LandMapMagicKey = string.IsNullOrWhiteSpace(landMapMagicKey) ? null : landMapMagicKey,
            CdlYear = _configuration["FieldTags:CdlYear"] ?? "2024",
            CdlFallbackYear = _configuration["FieldTags:CdlFallbackYear"] ?? "2023"
        });
    }
}
```

New response DTO, alongside the existing `FieldTagConfigResponse.cs`:
`api/GrainOriginatorPortal.Api/Models/Responses/MapConfigResponse.cs`:

```csharp
public class MapConfigResponse
{
    public string? AzureMapsKey { get; set; }
    public string? LandMapMagicKey { get; set; }
    public string CdlYear { get; set; } = "2024";
    public string CdlFallbackYear { get; set; } = "2023";
}
```

Response shape:

```json
{
  "azureMapsKey": "string | null",
  "landMapMagicKey": "string | null",
  "cdlYear": "2024",
  "cdlFallbackYear": "2023"
}
```

Frontend handling of each field:

- `azureMapsKey: null` — basemap cannot render; the map component should surface an error state
  (not silently render a blank map) since the basemap is not optional for Bid Sheet.
- `landMapMagicKey: null` — the CLU/Parcel toggle button is hidden entirely (feature not available,
  not a broken button); the field-context lookup on pin-drop/pin-select is skipped silently.

## Config keys

Reuses the exact same `FieldTags:*` configuration section field-tagging already established — no
new secret, no new Key Vault entry, no new user-secrets setup step for anyone who has already
configured field-tagging locally:

| Key | Source | Shared with field-tagging? |
|---|---|---|
| `FieldTags:AzureMapsKey` | dotnet user-secrets (local) / Key Vault (deployed) | Yes — same key, same value |
| `FieldTags:LandMapMagicKey` | dotnet user-secrets (local) / Key Vault (deployed) | Yes — same key, same value |
| `FieldTags:CdlYear` | appsettings / user-secrets | Yes |
| `FieldTags:CdlFallbackYear` | appsettings / user-secrets | Yes |
| `FieldTags:LocalStorePath` | — | **Not read by `MapConfigController`** — field-tagging-only, irrelevant to Bid Sheet |

If the `FieldTags:*` naming ever feels wrong for a config section now serving two features, a
cosmetic rename to a neutral `Maps:*` section (read by both controllers) is a safe follow-up — not
required for this migration to work correctly.

## `ApiService.getMapConfig()`

Added to `client/src/app/core/services/api.service.ts`, mirroring the existing
`getFieldTagConfig()` (same file, uses the same `_dedupe` in-flight-request caching helper so
repeated calls within one navigation don't double-fetch):

```ts
getMapConfig(): Observable<MapConfig> {
  return this._dedupe('map-config',
    this.http.get<MapConfig>(`${this.baseUrl}/map-config`)
      .pipe(catchError(e => this.handleError(e)))
  );
}
```

New model interface (co-locate with `BidSheetLocation` or in a small shared map-config model file —
implementation's call; not `FieldTagMapConfig`, since that interface's shape is intentionally
field-tagging's own and this endpoint's response, while similar, is a distinct contract):

```ts
export interface MapConfig {
  azureMapsKey: string | null;
  landMapMagicKey: string | null;
  cdlYear: string;
  cdlFallbackYear: string;
}
```

## No other backend changes

- `FieldTagConfigController` is untouched.
- No changes to `BidSheetLocation`'s persistence, any bid-sheet controller, or any EF model/
  migration. This entire doc is the full backend surface this migration adds.
