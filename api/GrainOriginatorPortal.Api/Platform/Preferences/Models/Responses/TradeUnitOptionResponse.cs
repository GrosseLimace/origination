namespace GrainOriginatorPortal.Api.Platform.Preferences.Models.Responses;

/// <summary>A single trade unit (code + optional description) for the onboarding TU picker.</summary>
public record TradeUnitOptionResponse
{
    public string Code { get; init; } = string.Empty;
    public string? Description { get; init; }
}
