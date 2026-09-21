using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class PlantingIntentionRepository : IPlantingIntentionRepository
{
    private readonly OriginationDbContext _context;
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<PlantingIntentionRepository> _logger;

    public PlantingIntentionRepository(OriginationDbContext context, ApplicationDbContext appContext, ILogger<PlantingIntentionRepository> logger)
    {
        _context = context;
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
            // Find customer codes from TU contracts + customer/TU memberships, then load
            // ALL their planting (cross-TU). Codes are resolved to CustomerIds and the
            // planting filter is on the FK column (CustomerCode column is gone in Phase 3b).
            var contractCustomerCodes = await _context.Contracts
                .AsNoTracking()
                .Where(c => c.IsActive && c.ContractPrefixType == "P" && c.CtrmCustomerId != null
                         && c.TradeUnit != null && tuList.Contains(c.TradeUnit))
                .Select(c => c.CtrmCustomerId!)
                .Distinct()
                .ToListAsync(cancellationToken);

            var customerIds = await _appContext.Customers
                .AsNoTracking()
                .Where(c => c.IsActive &&
                    ((c.ScoularId != null && contractCustomerCodes.Contains(c.ScoularId))
                     || _appContext.CustomerTradeUnits.Any(ctu =>
                            ctu.CustomerId == c.Id && ctu.IsActive && tuList.Contains(ctu.TradeUnit))))
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
        string? description, int acres, int plantingYear, string currentUser, CancellationToken cancellationToken)
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
        intention.ModifiedBy = currentUser;
        intention.ModifiedAt = DateTime.UtcNow;

        await _appContext.SaveChangesAsync(cancellationToken);

        _logger.LogInformation("Updated planting intention {Id}", intentionId);
        intention.CustomerName = intention.Customer?.Name ?? string.Empty;
        intention.CustomerCode = intention.Customer?.ScoularId ?? string.Empty;
        return intention;
    }

    public async Task DeleteAsync(int intentionId, string currentUser, CancellationToken cancellationToken)
    {
        // Soft delete: keep the row, mark IsDeleted/DeletedAt/DeletedBy. The global query filter
        // in ApplicationDbContext hides it from every read, so user-facing behaviour is unchanged,
        // but the plan can be recovered by flipping IsDeleted back to false.
        //
        // This replaced a HARD delete on 2026-09-21. The route is a live UI button
        // (home.component.ts deletePlantingIntention), so the realistic loss is an originator
        // removing the wrong row — not an attacker. The AUDIT_DELETE line records who and which
        // id, but never the acreage, so attribution alone could not reconstruct the plan (M-043).
        var intention = await _appContext.PlantingIntentions.FirstOrDefaultAsync(p => p.Id == intentionId, cancellationToken);
        if (intention != null)
        {
            intention.IsDeleted = true;
            intention.DeletedAt = DateTime.UtcNow;
            intention.DeletedBy = currentUser;
            await _appContext.SaveChangesAsync(cancellationToken);
            _logger.LogInformation(
                "Soft-deleted planting intention [{ErrorCode}] [{ErrorCategory}]: IntentionId={IntentionId} User={User} Crop={Crop} Acres={Acres} PlantingYear={PlantingYear}",
                "AUDIT_DELETE", "DataMutation", intentionId, currentUser, intention.Crop, intention.Acres, intention.PlantingYear);
        }
    }
}
