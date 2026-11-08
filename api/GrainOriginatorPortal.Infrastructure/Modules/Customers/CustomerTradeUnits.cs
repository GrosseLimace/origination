// Microsoft namespaces
using Microsoft.EntityFrameworkCore;

// Project namespaces
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Platform.Extensions;

namespace GrainOriginatorPortal.Infrastructure.Modules.Customers;

/// <summary>The customer trade-unit memberships Platform asks about, read from <c>dbo.CustomerTradeUnit</c>.</summary>
public sealed class CustomerTradeUnits(ApplicationDbContext appContext) : ICustomerTradeUnits
{
    public async Task<List<string>> GetActiveCodesAsync(long customerId, CancellationToken cancellationToken)
    {
        var codes = await appContext.CustomerTradeUnits.AsNoTracking()
            .Where(t => t.CustomerId == customerId && t.IsActive)
            .Select(t => t.TradeUnit).ToListAsync(cancellationToken);
        return codes.Select(c => c.Trim()).Where(c => c.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task<List<string>> GetAllActiveCodesAsync(CancellationToken cancellationToken)
    {
        return await appContext.CustomerTradeUnits
            .AsNoTracking()
            .Where(ctu => ctu.IsActive)
            .Select(ctu => ctu.TradeUnit)
            .Distinct()
            .OrderBy(t => t)
            .ToListAsync(cancellationToken);
    }
}
