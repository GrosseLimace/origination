namespace GrainOriginatorPortal.Api.Modules.Customers.Models.Responses;

/// <summary>Wire shape for a customer/producer. Entity-shaped (Decision 1); preserves the nested coordinates
/// shape. A producer's acres, links, contacts, bin sites and grain on farm are their saved details, which the Producers
/// module serves (<c>/api/producer-details</c>), not part of the customer.</summary>
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
    public bool ESignEnabled { get; init; }
    public bool AchEnabled { get; init; }
    /// <summary>The producer's active trade-unit codes. Populated on list and search reads; empty on
    /// single-customer reads, where callers fetch <c>/customers/{id}/trade-units</c> instead.</summary>
    public List<string> ActiveTradeUnits { get; init; } = new();
    public string? ScoularViewRecipients { get; init; }
    public string? Guild { get; init; }
    public CoordinatesResponse? Coordinates { get; init; }
    public string? IndustryCode1 { get; init; }
    public string? IndustryCode2 { get; init; }
    /// <summary>Real 10-digit NOP operation id, or null. Normalised on ingest, so the client can
    /// treat any non-null value as genuine — placeholders never reach the wire.</summary>
    public string? NopId { get; init; }
    public bool IsActive { get; init; }
    public DateTime? EffectiveStartDate { get; init; }
    public DateTime? EffectiveEndDate { get; init; }
    public bool IsManual { get; init; }
}
