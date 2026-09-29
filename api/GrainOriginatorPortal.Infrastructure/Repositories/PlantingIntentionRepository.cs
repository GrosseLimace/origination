using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class PlantingIntentionRepository : IPlantingIntentionRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<PlantingIntentionRepository> _logger;

    public PlantingIntentionRepository(ApplicationDbContext appContext, ILogger<PlantingIntentionRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<List<PlantingIntention>> GetAsync(IEnumerable<string>? tradeUnits, int? plantingYear, CancellationToken cancellationToken)
    {
        IQueryable<PlantingIntention> query = _appContext.PlantingIntentions
            .AsNoTracking()
            .Include(p => p.Customer);
        var tuList = tradeUnits?.Where(t => !string.IsNullOrEmpty(t)).ToList();
        if (tuList is { Count: > 0 })
        {
            // Scope on the app's OWN customer/trade-unit snapshot, then load ALL their planting
            // (cross-TU). The planting filter is on the FK column (CustomerCode was dropped in Phase 3b).
            //
            // This used to also union in producer codes from ODS base.vw_CurrentContracts. That read is
            // gone: it was the last ODS *contract* read on the CTRM path, and measuring it showed the
            // union could not add a single producer this screen can render. Across trade units 1340,
            // 2057, 2115 and 2190 (2026-09-08) the contract scan contributed 29-30 codes apiece that
            // membership alone missed, and every one of them was absent from dbo.Customer entirely -
            // commercial counterparties (ADM, Bunge, grain companies) that Scoular buys from. Since
            // codes are resolved to CustomerIds through dbo.Customer, a code with no customer row can
            // never produce a planting record. Producers in dbo.Customer but missing a membership row
            // would have been a real loss; there were zero of those on all four units.
            var customerIds = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive && _appContext.CustomerTradeUnits.Any(ctu =>
                        ctu.CustomerId == c.Id && ctu.IsActive && tuList.Contains(ctu.TradeUnit)))
                .Select(c => c.Id)
                .ToListAsync(cancellationToken);

            query = query.Where(p => customerIds.Contains(p.CustomerId));
        }
        if (plantingYear.HasValue)
        {
            query = query.Where(p => p.PlantingYear == plantingYear.Value);
        }
        var results = await query
            .OrderByDescending(p => p.PlantingYear)
            .ThenBy(p => p.Customer!.Name)
            .ToListAsync(cancellationToken);
        foreach (var r in results)
        {
            // CustomerName / CustomerCode now come from the Customer FK join
            // (the columns were dropped from dbo.ProducerPlantingIntentions in Phase 3b).
            r.CustomerName = r.Customer?.Name ?? string.Empty;
            r.CustomerCode = r.Customer?.ScoularId ?? string.Empty;
        }
        return results;
    }

    public async Task<List<PlantingIntention>> GetByCustomerAsync(long customerId, CancellationToken cancellationToken)
    {
        var results = await _appContext.PlantingIntentions
            .AsNoTracking()
            .Include(p => p.Customer)
            .Where(p => p.CustomerId == customerId)
            .OrderByDescending(p => p.PlantingYear)
            .ThenBy(p => p.Crop)
            .ToListAsync(cancellationToken);
        foreach (var r in results)
        {
            r.CustomerName = r.Customer?.Name ?? string.Empty;
            r.CustomerCode = r.Customer?.ScoularId ?? string.Empty;
        }
        return results;
    }

    public async Task<PlantingIntention?> GetByIdAsync(int intentionId, CancellationToken cancellationToken)
    {
        var intention = await _appContext.PlantingIntentions.AsNoTracking()
            .Include(p => p.Customer)
            .FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
        if (intention != null)
        {
            intention.CustomerName = intention.Customer?.Name ?? string.Empty;
            intention.CustomerCode = intention.Customer?.ScoularId ?? string.Empty;
        }
        return intention;
    }

    public async Task<PlantingIntention> AddAsync(long customerId, string customerName, string customerCode, string tradeUnit,
        string crop, string? category, string? type, string? description, int acres, int plantingYear,
        string currentUser, CancellationToken cancellationToken)
    {
        // CustomerName / CustomerCode are kept on the in-memory entity for the
        // API response, but EF .Ignore()s them — they're not persisted to the
        // dropped columns. They come back fresh via FK join on subsequent reads.
        var intention = new PlantingIntention
        {
            CustomerId = customerId,
            CustomerName = customerName,
            CustomerCode = customerCode,
            TradeUnit = tradeUnit,
            Crop = crop,
            Category = category,
            Type = type,
            Description = description,
            Acres = acres,
            PlantingYear = plantingYear,
            CreatedBy = currentUser,
            CreatedAt = DateTime.UtcNow
        };

        _appContext.PlantingIntentions.Add(intention);
        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Created planting intention {Id} for customer {CustomerId}", intention.Id, customerId);
        return intention;
    }

    public async Task<PlantingIntention?> UpdateAsync(int intentionId, string crop, string? category, string? type,
        string? description, int acres, int plantingYear, string? tradeUnit, string currentUser, CancellationToken cancellationToken)
    {
        var intention = await _appContext.PlantingIntentions
            .Include(p => p.Customer)
            .FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
        if (intention == null)
        {
            return null;
        }

        intention.Crop = crop;
        intention.Category = category;
        intention.Type = type;
        intention.Description = description;
        intention.Acres = acres;
        intention.PlantingYear = plantingYear;
        if (tradeUnit is not null)
        {
            intention.TradeUnit = tradeUnit;
        }
        intention.ModifiedBy = currentUser;
        intention.ModifiedAt = DateTime.UtcNow;

        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Updated planting intention {Id}", intentionId);
        intention.CustomerName = intention.Customer?.Name ?? string.Empty;
        intention.CustomerCode = intention.Customer?.ScoularId ?? string.Empty;
        return intention;
    }

    public async Task<int> RetagAsync(long customerId, string fromTradeUnit, string toTradeUnit, string currentUser, CancellationToken cancellationToken)
    {
        // Soft-deleted rows are excluded by the entity's global query filter, so a deleted plan
        // doesn't follow the producer to their new trade unit.
        var rows = await _appContext.PlantingIntentions
            .Where(p => p.CustomerId == customerId && p.TradeUnit == fromTradeUnit)
            .ToListAsync(cancellationToken);
        if (rows.Count == 0) return 0;

        var now = DateTime.UtcNow;
        foreach (var row in rows)
        {
            row.TradeUnit = toTradeUnit;
            row.ModifiedBy = currentUser;
            row.ModifiedAt = now;
        }
        await _appContext.SaveChangesAsync(cancellationToken);

        // The ids make the move reversible: afterwards the moved rows are indistinguishable from any
        // already on the target trade unit, and ModifiedBy only says who touched them last.
        _logger.LogInformation(
            "Retagged {Count} planting intention(s) for customer {CustomerId} from {FromTradeUnit} to {ToTradeUnit} by {User}: IntentionIds={IntentionIds}",
            rows.Count, customerId, fromTradeUnit, toTradeUnit, currentUser, string.Join(",", rows.Select(r => r.Id)));
        return rows.Count;
    }

    public async Task DeleteAsync(int intentionId, string currentUser, CancellationToken cancellationToken)
    {
        // Soft delete: keep the row, mark IsDeleted/DeletedAt/DeletedBy. The global query filter
        // in ApplicationDbContext hides it from every read, so user-facing behaviour is unchanged,
        // but the plan can be recovered by flipping IsDeleted back to false.
        //
        // This replaced a HARD delete on 2026-09-21. The route is a live UI button
        // (home.component.ts deletePlantingIntention), so the realistic loss is an originator
        // removing the wrong row — not an attacker.
        //
        // The AUDIT_DELETE line deliberately carries only who, which id and when — never the crop
        // or the acreage. Under the hard delete those figures were the only surviving trace, which
        // is what M-043 was about; the soft-deleted ROW is now the record, and it holds the whole
        // plan. Repeating the acreage in a log would put confidential figures somewhere retained on
        // different terms and readable by a wider audience, and buy nothing back.
        var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
        if (intention != null)
        {
            intention.IsDeleted = true;
            intention.DeletedAt = DateTime.UtcNow;
            intention.DeletedBy = currentUser;
            await _appContext.SaveChangesAsync(cancellationToken);
            _logger.LogInformation(
                "Soft-deleted planting intention [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId} User={User} DeletedAt={DeletedAt}",
                "AUDIT_DELETE", "DataMutation", intentionId, currentUser, intention.DeletedAt);
        }
    }
}
