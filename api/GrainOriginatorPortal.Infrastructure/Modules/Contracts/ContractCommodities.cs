// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Extensions;

namespace GrainOriginatorPortal.Infrastructure.Modules.Contracts;

/// <summary>The commodities on ODS purchase contracts, for Platform's commodity seed.</summary>
public sealed class ContractCommodities(OriginationDbContext ods) : IContractCommodities
{
    public async Task<List<(string Code, string Description)>> GetPurchaseContractCommoditiesAsync(CancellationToken cancellationToken)
    {
        var rows = await ods.Contracts.AsNoTracking()
            .Where(c => c.ContractPrefixType == "P" && c.CommodityCode != null && c.CommodityCode != ""
                     && c.CommodityDescription != null && c.CommodityDescription != "")
            .Select(c => new { c.CommodityCode, c.CommodityDescription })
            .Distinct()
            .ToListAsync(cancellationToken);
        return rows.Select(r => (r.CommodityCode!, r.CommodityDescription!)).ToList();
    }
}
