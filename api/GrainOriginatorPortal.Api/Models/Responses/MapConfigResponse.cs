namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Runtime map configuration handed to the SPA for any MapLibre/Azure Maps consumer that isn't
/// field-tagging-specific (currently: Bid Sheet). Unlike FieldTagConfigResponse, each key is
/// independently nullable — the basemap must work even if LandMapMagic isn't configured, and the
/// CLU/Parcel toggle should hide itself on a missing vendor key without affecting the basemap. See
/// docs/poc/bid-sheet-map/02-backend-api.md.
/// </summary>
public record MapConfigResponse
{
    public string? AzureMapsKey { get; init; }
    public string? LandMapMagicKey { get; init; }
    public string CdlYear { get; init; } = "2024";
    public string CdlFallbackYear { get; init; } = "2023";
}
