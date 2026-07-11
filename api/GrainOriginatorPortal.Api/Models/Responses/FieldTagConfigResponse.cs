namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>
/// Runtime map configuration handed to the SPA so the LandMapMagic/Azure Maps keys never live in
/// a committed Angular file. Keys come from user-secrets (local) / Key Vault (deployed) via the
/// FieldTags:* config section — see docs/poc/field-tagging/02-backend-api.md.
/// </summary>
public record FieldTagConfigResponse
{
    public bool Enabled { get; init; }
    public string? AzureMapsKey { get; init; }
    public string? LandMapMagicKey { get; init; }
    public string CdlYear { get; init; } = "2024";
    public string CdlFallbackYear { get; init; } = "2023";
}
