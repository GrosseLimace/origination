// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Services.Diagnostics;

/// <summary>
/// Extracted verbatim from DiagnosticsController (audit finding
/// dotnet.diagnostics-controller-bypasses-service-layer).
/// </summary>
public sealed class CommoditySeedService : ICommoditySeedService
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;

    public CommoditySeedService(OriginationDbContext context, ApplicationDbContext appContext)
    {
        _context = context;
        _appContext = appContext;
    }

    public async Task<CommoditySeedResult> SeedAsync(CancellationToken cancellationToken)
    {
        // Get distinct commodity codes from ODS contracts
        var odsContracts = await _context.Contracts.AsNoTracking()
            .Where(c => c.ContractPrefixType == "P" && c.CommodityCode != null && c.CommodityCode != ""
                     && c.CommodityDescription != null && c.CommodityDescription != "")
            .Select(c => new { c.CommodityCode, c.CommodityDescription })
            .Distinct()
            .ToListAsync(cancellationToken);

        // Get existing commodity codes
        var existingCodes = await _appContext.Commodities
            .Select(c => c.Code)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<string>(existingCodes, StringComparer.OrdinalIgnoreCase);

        int inserted = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in odsContracts)
        {
            var code = item.CommodityCode!.Trim();
            if (existingSet.Contains(code) || seen.Contains(code)) continue;
            seen.Add(code);

            _appContext.Commodities.Add(new Commodity
            {
                Code = code,
                Name = item.CommodityDescription!.Trim(),
                IsActive = true
            });
            inserted++;
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        return new CommoditySeedResult(inserted, existingCodes.Count, odsContracts.Count);
    }
}
