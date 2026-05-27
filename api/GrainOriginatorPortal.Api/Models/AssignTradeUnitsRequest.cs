namespace GrainOriginatorPortal.Api.Models;

/// <summary>Request body for PUT /api/customers/{id}/trade-units — the trade-unit codes
/// to assign to a producer when onboarding them manually.</summary>
public class AssignTradeUnitsRequest
{
    public List<string>? TradeUnitCodes { get; set; }
}
