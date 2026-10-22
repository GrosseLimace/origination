namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Request body for PUT /api/customers/{id}/trade-units — the trade-unit codes
/// to assign to a producer when onboarding them manually.</summary>
public record AssignTradeUnitsRequest
{
    public List<string>? TradeUnitCodes { get; init; }

    /// <summary>The producer's Scoular customer code (plan E4). Sent for a candidate the CTRM onboarding
    /// search returned, whose id in the URL is only a negative placeholder: the server loads the producer
    /// by this code and mints the real id. Optional; an ODS candidate still onboards by its id alone.</summary>
    public string? ScoularId { get; init; }
}
