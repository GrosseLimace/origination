// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Platform.Extensions;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer). The commodities on purchase contracts come from the
/// Contracts module (<see cref="IContractCommodities"/>).
/// </summary>
public sealed class CommoditySeedService : ICommoditySeedService
{
    private readonly IContractCommodities _contractCommodities;
    private readonly ApplicationDbContext _appContext;

    public CommoditySeedService(IContractCommodities contractCommodities, ApplicationDbContext appContext)
    {
        _contractCommodities = contractCommodities;
        _appContext = appContext;
    }

    public async Task<CommoditySeedResult> SeedAsync(CancellationToken cancellationToken)
    {
        // Get distinct commodity codes from ODS contracts
        var odsContracts = await _contractCommodities.GetPurchaseContractCommoditiesAsync(cancellationToken);

        // Get existing commodity codes
        var existingCodes = await _appContext.Commodities
            .Select(c => c.Code)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<string>(existingCodes, StringComparer.OrdinalIgnoreCase);

        int inserted = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in odsContracts)
        {
            var code = item.Code.Trim();
            if (existingSet.Contains(code) || seen.Contains(code)) continue;
            seen.Add(code);

            _appContext.Commodities.Add(new Commodity
            {
                Code = code,
                Name = item.Description.Trim(),
                IsActive = true
            });
            inserted++;
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        return new CommoditySeedResult(inserted, existingCodes.Count, odsContracts.Count);
    }
}
