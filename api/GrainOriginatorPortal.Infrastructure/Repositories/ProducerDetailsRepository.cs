using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class ProducerDetailsRepository : IProducerDetailsRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<ProducerDetailsRepository> _logger;

    public ProducerDetailsRepository(ApplicationDbContext appContext, ILogger<ProducerDetailsRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<ProducerDetails?> GetAsync(long customerId, CancellationToken cancellationToken)
    {
        var pd = await _appContext.ProducerDetails.AsNoTracking()
            .Include(p => p.Customer)
            .FirstOrDefaultAsync(p => p.CustomerId == customerId, cancellationToken);
        if (pd == null) return null;

        // CustomerName / ScoularId now come from the Customer FK join
        // (the columns were dropped from dbo.ProducerDetails in Phase 3b).
        pd.CustomerName = pd.Customer?.Name ?? string.Empty;
        pd.ScoularId = pd.Customer?.ScoularId;
        // LinkedProducerIds (CSV of linked-producer ScoularIds) is composed from
        // dbo.CustomerLink — the CSV column was dropped in Phase 3b.
        pd.LinkedProducerIds = await GetLinkedProducerCsvAsync(customerId, cancellationToken);
        // Commodities (CSV of commodity codes) is composed from dbo.CustomerCommodity
        // — the CSV column was dropped in Phase 4b.
        pd.Commodities = await GetCommodityCodesCsvAsync(customerId, cancellationToken);
        // Per-commodity grain-on-farm breakdown composed from dbo.ProducerGrainOnFarm.
        pd.GrainOnFarm = await GetGrainOnFarmAsync(customerId, cancellationToken);
        return pd;
    }

    public async Task<List<ProducerDetails>> GetAllAsync(CancellationToken cancellationToken)
    {
        var all = await _appContext.ProducerDetails.AsNoTracking()
            .Include(p => p.Customer)
            .ToListAsync(cancellationToken);

        // Batch-fetch all CustomerLink rows for these producers in one round-trip,
        // then group in memory and assign as comma-separated ScoularIds.
        var customerIds = all.Select(p => p.CustomerId).Distinct().ToList();
        var linkRows = await _appContext.CustomerLinks.AsNoTracking()
            .Where(l => customerIds.Contains(l.FromCustomerId))
            .Join(_appContext.Customers.AsNoTracking(),
                  l => l.ToCustomerId,
                  c => c.Id,
                  (l, c) => new { l.FromCustomerId, c.ScoularId })
            .Where(x => x.ScoularId != null)
            .ToListAsync(cancellationToken);
        var linksByFrom = linkRows
            .GroupBy(x => x.FromCustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.ScoularId!).ToList());

        // Same batching pattern for CustomerCommodity → commodity codes.
        var commodityRows = await _appContext.CustomerCommodities.AsNoTracking()
            .Where(cc => customerIds.Contains(cc.CustomerId))
            .Join(_appContext.Commodities.AsNoTracking(),
                  cc => cc.CommodityId,
                  c => c.Id,
                  (cc, c) => new { cc.CustomerId, c.Code })
            .Where(x => !string.IsNullOrEmpty(x.Code))
            .ToListAsync(cancellationToken);
        var commoditiesByCustomer = commodityRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToList());

        // Same batching pattern for ProducerGrainOnFarm → per-group on-hand/target rows.
        var grainRows = await _appContext.ProducerGrainOnFarm.AsNoTracking()
            .Where(g => customerIds.Contains(g.CustomerId))
            .Select(g => new { g.CustomerId, g.CommodityGroup, g.BushelsOnHand, g.TargetBushels, g.Grade })
            .ToListAsync(cancellationToken);
        var grainByCustomer = grainRows
            .GroupBy(x => x.CustomerId)
            .ToDictionary(g => g.Key, g => g.Select(x => new GrainOnFarmEntry
            {
                CommodityGroup = x.CommodityGroup,
                BushelsOnHand = x.BushelsOnHand,
                TargetBushels = x.TargetBushels,
                Grade = x.Grade
            }).ToList());

        foreach (var p in all)
        {
            p.CustomerName = p.Customer?.Name ?? string.Empty;
            p.ScoularId = p.Customer?.ScoularId;
            p.LinkedProducerIds = linksByFrom.TryGetValue(p.CustomerId, out var ids) && ids.Count > 0
                ? string.Join(",", ids)
                : null;
            p.Commodities = commoditiesByCustomer.TryGetValue(p.CustomerId, out var codes) && codes.Count > 0
                ? string.Join(",", codes)
                : null;
            p.GrainOnFarm = grainByCustomer.TryGetValue(p.CustomerId, out var grain) ? grain : new();
        }
        return all;
    }

    public async Task<ProducerDetails> UpsertAsync(long customerId, string? scoularId, string customerName, decimal? totalAcres,
        decimal? binCapacity, string? primaryContact, string? primaryPhone, string? commodities, string? linkedProducerIds,
        IReadOnlyList<GrainOnFarmEntry> grainOnFarm, string currentUser, CancellationToken cancellationToken)
    {
        var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

        ProducerDetails saved;
        if (existing != null)
        {
            // ScoularId / CustomerName are kept on the in-memory entity for the
            // API response, but EF .Ignore()s them — they're not persisted to
            // dropped columns. The canonical values come from dbo.Customer.
            existing.ScoularId = scoularId;
            existing.CustomerName = customerName;
            existing.TotalAcres = totalAcres;
            existing.BinCapacity = binCapacity;
            existing.PrimaryContact = primaryContact;
            existing.PrimaryPhone = primaryPhone;
            existing.Commodities = commodities;
            existing.LinkedProducerIds = linkedProducerIds;  // in-memory only; persisted via CustomerLink rebuild below
            existing.ModifiedBy = currentUser;
            existing.ModifiedAt = DateTime.UtcNow;
            saved = existing;
        }
        else
        {
            saved = new ProducerDetails
            {
                CustomerId = customerId,
                ScoularId = scoularId,
                CustomerName = customerName,
                TotalAcres = totalAcres,
                BinCapacity = binCapacity,
                PrimaryContact = primaryContact,
                PrimaryPhone = primaryPhone,
                Commodities = commodities,
                LinkedProducerIds = linkedProducerIds,
                CreatedBy = currentUser,
                CreatedAt = DateTime.UtcNow
            };
            _appContext.ProducerDetails.Add(saved);
        }

        // Rebuild dbo.CustomerLink for this from-customer in the same EF
        // transaction as the ProducerDetails write. Drop all existing links
        // and re-insert based on the supplied CSV of linked ScoularIds.
        var oldLinks = await _appContext.CustomerLinks
            .Where(l => l.FromCustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldLinks.Count > 0)
        {
            _appContext.CustomerLinks.RemoveRange(oldLinks);
        }
        if (!string.IsNullOrWhiteSpace(linkedProducerIds))
        {
            var ids = linkedProducerIds
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var toCustomerIds = await _appContext.Customers.AsNoTracking()
                .Where(c => c.ScoularId != null && ids.Contains(c.ScoularId))
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);
            foreach (var toId in toCustomerIds.Where(id => id != customerId).Distinct())
            {
                _appContext.CustomerLinks.Add(new CustomerLink
                {
                    FromCustomerId = customerId,
                    ToCustomerId = toId
                });
            }
        }

        // Same rebuild pattern for dbo.CustomerCommodity. Parse the CSV of
        // commodity codes, resolve each to a CommodityId via dbo.Commodities,
        // and replace the customer's commodity set in the same transaction.
        // Codes not in the lookup are silently skipped — the UI's commodity
        // picker only surfaces valid codes.
        var oldCommodities = await _appContext.CustomerCommodities
            .Where(cc => cc.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldCommodities.Count > 0)
        {
            _appContext.CustomerCommodities.RemoveRange(oldCommodities);
        }
        if (!string.IsNullOrWhiteSpace(commodities))
        {
            var codes = commodities
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            var commodityIds = await _appContext.Commodities.AsNoTracking()
                .Where(c => codes.Contains(c.Code))
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);
            foreach (var commodityId in commodityIds.Distinct())
            {
                _appContext.CustomerCommodities.Add(new CustomerCommodity
                {
                    CustomerId = customerId,
                    CommodityId = commodityId
                });
            }
        }

        // Same rebuild pattern for dbo.ProducerGrainOnFarm — replace the customer's per-group
        // grain-on-farm set. Dedupe by group (last write wins); skip blank groups.
        var oldGrain = await _appContext.ProducerGrainOnFarm
            .Where(g => g.CustomerId == customerId)
            .ToListAsync(cancellationToken);
        if (oldGrain.Count > 0)
        {
            _appContext.ProducerGrainOnFarm.RemoveRange(oldGrain);
        }
        var grainItems = grainOnFarm
            .Where(g => !string.IsNullOrWhiteSpace(g.CommodityGroup))
            .GroupBy(g => g.CommodityGroup.Trim(), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.Last())
            .ToList();
        foreach (var item in grainItems)
        {
            _appContext.ProducerGrainOnFarm.Add(new ProducerGrainOnFarm
            {
                CustomerId = customerId,
                CommodityGroup = item.CommodityGroup.Trim(),
                BushelsOnHand = item.BushelsOnHand,
                TargetBushels = item.TargetBushels,
                Grade = string.IsNullOrWhiteSpace(item.Grade) ? null : item.Grade.Trim()
            });
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        // Reflect the persisted grain-on-farm set (with commodity names) back on the returned entity
        // so the upsert response carries the breakdown.
        saved.GrainOnFarm = await GetGrainOnFarmAsync(customerId, cancellationToken);
        _logger.LogInformation("Upserted ProducerDetails for customer {CustomerId}", customerId);
        return saved;
    }

    /// <inheritdoc />
    public async Task<ProducerDetails> UpdateTotalAcresAsync(long customerId, decimal totalAcres, string currentUser, CancellationToken cancellationToken)
    {
        var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);

        ProducerDetails saved;
        if (existing != null)
        {
            existing.TotalAcres = totalAcres;
            existing.ModifiedBy = currentUser;
            existing.ModifiedAt = DateTime.UtcNow;
            saved = existing;
        }
        else
        {
            var customer = await _appContext.Customers.AsNoTracking()
                .Where(c => c.Id == customerId)
                .Select(c => new { CustomerName = c.Name, c.ScoularId })
                .FirstOrDefaultAsync(cancellationToken);

            saved = new ProducerDetails
            {
                CustomerId = customerId,
                ScoularId = customer?.ScoularId,
                CustomerName = customer?.CustomerName ?? string.Empty,
                TotalAcres = totalAcres,
                CreatedBy = currentUser,
                CreatedAt = DateTime.UtcNow
            };
            _appContext.ProducerDetails.Add(saved);
        }

        await _appContext.SaveChangesAsync(cancellationToken);
        _logger.LogInformation("Updated TotalAcres for customer {CustomerId} to {TotalAcres} (field-tagging POC)", customerId, totalAcres);
        return saved;
    }

    public async Task DeleteAsync(long customerId, CancellationToken cancellationToken)
    {
        var existing = await _appContext.ProducerDetails.FirstOrDefaultAsync(pd => pd.CustomerId == customerId, cancellationToken);
        if (existing != null)
        {
            _appContext.ProducerDetails.Remove(existing);
            await _appContext.SaveChangesAsync(cancellationToken);
            _logger.LogInformation("Deleted ProducerDetails for customer {CustomerId}", customerId);
        }
    }

    /// <summary>
    /// Composes the comma-separated list of linked-producer ScoularIds for a given
    /// from-customer by joining dbo.CustomerLink → dbo.Customer.ScoularId. Returns
    /// null when there are no links, matching the prior nullable-CSV semantics.
    /// </summary>
    private async Task<string?> GetLinkedProducerCsvAsync(long fromCustomerId, CancellationToken cancellationToken)
    {
        var scoularIds = await _appContext.CustomerLinks.AsNoTracking()
            .Where(l => l.FromCustomerId == fromCustomerId)
            .Join(_appContext.Customers.AsNoTracking(),
                  l => l.ToCustomerId,
                  c => c.Id,
                  (l, c) => c.ScoularId)
            .Where(s => s != null)
            .ToListAsync(cancellationToken);
        return scoularIds.Count == 0 ? null : string.Join(",", scoularIds!);
    }

    /// <summary>
    /// Composes the comma-separated list of commodity codes a customer grows
    /// by joining dbo.CustomerCommodity → dbo.Commodities.Code. Returns null
    /// when there are no rows, matching the prior nullable-CSV semantics on
    /// ProducerDetails.Commodities.
    /// </summary>
    private async Task<string?> GetCommodityCodesCsvAsync(long customerId, CancellationToken cancellationToken)
    {
        var codes = await _appContext.CustomerCommodities.AsNoTracking()
            .Where(cc => cc.CustomerId == customerId)
            .Join(_appContext.Commodities.AsNoTracking(),
                  cc => cc.CommodityId,
                  c => c.Id,
                  (cc, c) => c.Code)
            .Where(code => !string.IsNullOrEmpty(code))
            .ToListAsync(cancellationToken);
        return codes.Count == 0 ? null : string.Join(",", codes);
    }

    /// <summary>Composes the per-group grain-on-farm rows for a customer from dbo.ProducerGrainOnFarm.</summary>
    private async Task<List<GrainOnFarmEntry>> GetGrainOnFarmAsync(long customerId, CancellationToken cancellationToken)
    {
        return await _appContext.ProducerGrainOnFarm.AsNoTracking()
            .Where(g => g.CustomerId == customerId)
            .Select(g => new GrainOnFarmEntry
            {
                CommodityGroup = g.CommodityGroup,
                BushelsOnHand = g.BushelsOnHand,
                TargetBushels = g.TargetBushels,
                Grade = g.Grade
            })
            .ToListAsync(cancellationToken);
    }
}
