namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Seeds dbo.Commodities from distinct CommodityCode/CommodityDescription in ODS contracts
/// (diagnostics route <c>commodities/seed</c>, Dev/QA only; the gate stays in the controller).
/// </summary>
public interface ICommoditySeedService
{
    /// <summary>Inserts every ODS purchase-contract commodity code that is not already present.
    /// Skips codes that already exist.</summary>
    Task<CommoditySeedResult> SeedAsync(CancellationToken cancellationToken);
}

public sealed record CommoditySeedResult(int Inserted, int AlreadyExisted, int TotalOds);
