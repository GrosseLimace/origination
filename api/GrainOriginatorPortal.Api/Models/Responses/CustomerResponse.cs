using System.Text.Json.Serialization;

namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for a customer/producer. Entity-shaped (Decision 1); preserves the
/// linkedProducerIds JSON name and the nested coordinates shape.</summary>
public record CustomerResponse
{
    public long Id { get; init; }
    public string? ScoularId { get; init; }
    public string? CustomerCode { get; init; }
    public string Name { get; init; } = string.Empty;
    public string? Location { get; init; }
    public string? StateProvince { get; init; }
    public string? AddressLine1 { get; init; }
    public string? PostalCode { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? ExtendedPrimaryPhone { get; init; }
    public string? SupplementalEmail { get; init; }
    public string? ExtendedAddressLine1 { get; init; }
    public string? ExtendedAddressLine2 { get; init; }
    public string? ExtendedAddressLine3 { get; init; }
    public string? ExtendedAddressLine4 { get; init; }
    public string? ExtendedCity { get; init; }
    public string? ExtendedPostalCode { get; init; }
    public string? ExtendedStateProvince { get; init; }
    public string? ExtendedCountry { get; init; }
    public int TotalAcres { get; init; }
    public List<string> FarmIds { get; init; } = new();

    [JsonPropertyName("linkedProducerIds")]
    public List<string> LinkedProducerIds { get; init; } = new();

    public bool ESignEnabled { get; init; }
    public bool AchEnabled { get; init; }
    public string? ScoularViewRecipients { get; init; }
    public string? Guild { get; init; }
    public CoordinatesResponse? Coordinates { get; init; }
    public string Farm { get; init; } = string.Empty;
    public string? IndustryCode1 { get; init; }
    public bool IsActive { get; init; }
    public DateTime? EffectiveStartDate { get; init; }
    public DateTime? EffectiveEndDate { get; init; }
    public bool IsManual { get; init; }
}
