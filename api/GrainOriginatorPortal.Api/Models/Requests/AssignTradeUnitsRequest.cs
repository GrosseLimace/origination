namespace GrainOriginatorPortal.Api.Models.Requests;

/// <summary>Request body for PUT /api/customers/{id}/trade-units — the trade-unit codes
/// to assign to a producer when onboarding them manually.</summary>
public record AssignTradeUnitsRequest
{
    public List<string>? TradeUnitCodes { get; init; }
}
