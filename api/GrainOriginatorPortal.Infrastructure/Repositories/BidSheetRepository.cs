using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

public class BidSheetRepository : IBidSheetRepository
{
    private readonly ApplicationDbContext _appContext;
    private readonly ILogger<BidSheetRepository> _logger;

    public BidSheetRepository(ApplicationDbContext appContext, ILogger<BidSheetRepository> logger)
    {
        _appContext = appContext;
        _logger = logger;
    }

    public async Task<List<ElevatorCache>> GetElevatorsAsync(string? tradeUnitCode, CancellationToken cancellationToken)
    {
        var query = _appContext.ElevatorCaches.AsNoTracking().Where(e => e.IsActive);

        if (!string.IsNullOrEmpty(tradeUnitCode))
            query = query.Where(e => e.TradeUnitCode == tradeUnitCode);

        return await query.ToListAsync(cancellationToken);
    }

    public async Task<List<BidSheetLocation>> GetLocationsAsync(string tradeUnitCode, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .Include(l => l.Bids)
            .Where(l => l.TradeUnitCode == tradeUnitCode)
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<BidSheetLocation>> GetAllLocationsAsync(CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .Include(l => l.Bids)
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<string?> GetLocationTradeUnitCodeAsync(int id, CancellationToken cancellationToken) =>
        await _appContext.BidSheetLocations
            .AsNoTracking()
            .Where(l => l.Id == id)
            .Select(l => l.TradeUnitCode)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<bool> LocationNameExistsAsync(string name, string tradeUnitCode, CancellationToken cancellationToken)
    {
        var trimmed = name.Trim();
        // String equality translates to SQL '=' under the column's (case-insensitive) collation,
        // matching the UQ_BidSheetLocations_Name_TradeUnit unique index.
        return _appContext.BidSheetLocations
            .AnyAsync(l => l.TradeUnitCode == tradeUnitCode && l.Name == trimmed, cancellationToken);
    }

    public Task<bool> BarchartLocationLinkedAsync(string barchartLocationKey, string tradeUnitCode, CancellationToken cancellationToken) =>
        _appContext.BidSheetLocations
            .AnyAsync(l => l.TradeUnitCode == tradeUnitCode && l.BarchartLocationKey == barchartLocationKey, cancellationToken);

    public async Task<BidSheetLocation?> GetLocationAsync(int id, CancellationToken cancellationToken) =>
        await _appContext.BidSheetLocations
            .AsNoTracking()
            .Include(l => l.Bids)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken);

    public async Task<BidSheetLocation> CreateLocationAsync(BidSheetLocation location, CancellationToken cancellationToken)
    {
        _appContext.BidSheetLocations.Add(location);
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // A child bid collided with a concurrently-inserted one — reconcile to updates and retry.
            _logger.LogWarning(ex, "CreateBidSheetLocation hit a unique-constraint race — reconciling");
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
        return location;
    }

    public async Task<BidSheetLocation?> UpdateLocationAsync(int id, BidSheetLocation location, CancellationToken cancellationToken)
    {
        var existing = await _appContext.BidSheetLocations
            .Include(l => l.Bids)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken);
        if (existing == null) return null;

        existing.Name = location.Name;
        existing.Address = location.Address;
        existing.City = location.City;
        existing.State = location.State;
        existing.Latitude = location.Latitude;
        existing.Longitude = location.Longitude;
        existing.IsScoularFacility = location.IsScoularFacility;
        existing.ModifiedBy = location.ModifiedBy;
        existing.ModifiedAt = DateTime.UtcNow;

        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _logger.LogWarning(ex, "UpdateBidSheetLocation hit a unique-constraint race — reconciling");
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
        return existing;
    }

    public async Task DeleteLocationAsync(int id, CancellationToken cancellationToken)
    {
        var existing = await _appContext.BidSheetLocations.FindAsync([id], cancellationToken);
        if (existing != null)
        {
            _appContext.BidSheetLocations.Remove(existing);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken)
    {
        var query = _appContext.BidSheetLocationBids
            // Feed-owned cells are read-only to users; only the BarChart bridge manages them.
            .Where(b => b.LocationId == locationId && b.CommodityCode == commodityCode && b.Source != BidSources.Barchart);
        if (month.HasValue)
            query = query.Where(b => b.Month == month.Value);
        var bids = await query.ToListAsync(cancellationToken);

        if (bids.Count > 0)
        {
            _appContext.BidSheetLocationBids.RemoveRange(bids);
            await _appContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task BulkUpsertBidsAsync(IEnumerable<BidUpsertInput> requests, string tradeUnitCode, string userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var requestList = requests.ToList();

        // Batch-load all locations for the trade unit (1 query instead of N)
        var allLocations = await _appContext.BidSheetLocations
            .Where(l => l.TradeUnitCode == tradeUnitCode)
            .ToListAsync(cancellationToken);

        var byElevator = new Dictionary<string, BidSheetLocation>();
        foreach (var l in allLocations.Where(l => !string.IsNullOrEmpty(l.ElevatorCode)))
            byElevator.TryAdd(l.ElevatorCode!, l);
        var byName = new Dictionary<string, BidSheetLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in allLocations)
            byName.TryAdd(l.Name.Trim(), l);

        // First pass: create any missing locations in batch
        var newLocations = new List<BidSheetLocation>();
        foreach (var req in requestList)
        {
            BidSheetLocation? loc = null;
            if (!string.IsNullOrEmpty(req.ElevatorCode))
                byElevator.TryGetValue(req.ElevatorCode, out loc);
            if (loc == null && !string.IsNullOrEmpty(req.Name))
                byName.TryGetValue(req.Name.Trim(), out loc);

            if (loc == null)
            {
                var name = (req.Name ?? req.ElevatorCode ?? string.Empty).Trim();
                // Check if we already queued a new location with this name
                if (!byName.TryGetValue(name, out loc))
                {
                    loc = new BidSheetLocation
                    {
                        Name = name,
                        ElevatorCode = req.ElevatorCode,
                        TradeUnitCode = tradeUnitCode,
                        GroupName = req.GroupName,
                        Latitude = req.Latitude,
                        Longitude = req.Longitude,
                        CreatedBy = userId,
                        CreatedAt = now
                    };
                    _appContext.BidSheetLocations.Add(loc);
                    newLocations.Add(loc);
                    byName[name] = loc;
                    if (!string.IsNullOrEmpty(req.ElevatorCode))
                        byElevator[req.ElevatorCode] = loc;
                }
            }
        }

        // Single SaveChanges to persist all new locations and get their IDs
        if (newLocations.Count > 0)
            await _appContext.SaveChangesAsync(cancellationToken);

        // Batch-load all existing bids for the affected locations (1 query instead of N)
        var locationIds = allLocations.Concat(newLocations).Select(l => l.Id).ToHashSet();
        var existingBids = await _appContext.BidSheetLocationBids
            .Where(b => locationIds.Contains(b.LocationId))
            .ToListAsync(cancellationToken);
        // CommodityCode is normalized to uppercase on both the stored key and the lookup key
        // so a DB value of "yc" matches a request value of "YC". Matches SQL Server's
        // case-insensitive collation; avoids INSERT attempts that would trip the unique index.
        var bidLookup = new Dictionary<(int, string, int, int), BidSheetLocationBid>();
        foreach (var b in existingBids)
            bidLookup.TryAdd((b.LocationId, (b.CommodityCode ?? "").ToUpperInvariant(), b.CropYear, b.Month), b);

        // Second pass: upsert bids using in-memory lookups (0 queries)
        foreach (var req in requestList)
        {
            BidSheetLocation? loc = null;
            if (!string.IsNullOrEmpty(req.ElevatorCode))
                byElevator.TryGetValue(req.ElevatorCode, out loc);
            if (loc == null && !string.IsNullOrEmpty(req.Name))
                byName.TryGetValue(req.Name.Trim(), out loc);
            if (loc == null) continue;

            var key = (loc.Id, (req.CommodityCode ?? "").ToUpperInvariant(), req.CropYear, req.Month);
            if (string.IsNullOrWhiteSpace(req.Bid))
            {
                // Empty bid = user cleared the input → delete the existing row if present.
                // Feed-owned cells are read-only to users — silently ignore the clear.
                if (bidLookup.TryGetValue(key, out var toRemove) && toRemove.Source != BidSources.Barchart)
                {
                    _appContext.BidSheetLocationBids.Remove(toRemove);
                    bidLookup.Remove(key);
                }
            }
            else if (bidLookup.TryGetValue(key, out var bid))
            {
                // Feed-owned cells are read-only to users — silently ignore the edit.
                if (bid.Source == BidSources.Barchart) continue;

                bid.Bid = req.Bid;
                bid.ModifiedBy = userId;
                bid.ModifiedAt = now;
            }
            else
            {
                var newBid = new BidSheetLocationBid
                {
                    LocationId = loc.Id,
                    CommodityCode = req.CommodityCode,
                    CommodityName = req.CommodityName,
                    CommodityCategory = req.CommodityCategory,
                    CropYear = req.CropYear,
                    Month = req.Month,
                    Bid = req.Bid,
                    Source = BidSources.Manual,
                    CreatedBy = userId,
                    CreatedAt = now
                };
                _appContext.BidSheetLocationBids.Add(newBid);
                bidLookup[key] = newBid;
            }
        }

        // Single final SaveChanges for all bid upserts. If a concurrent request inserted one of
        // these bids first, reconcile the colliding inserts into updates and save again so the
        // whole batch commits (rather than rolling back and 500-ing).
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            _logger.LogWarning(ex, "Bid upsert hit a unique-constraint race — reconciling");
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
                await _appContext.SaveChangesAsync(cancellationToken);
            else throw;
        }
    }

    public async Task<List<int>> GetBidCropYearsAsync(string tradeUnitCode, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode)
            .Select(b => b.CropYear)
            .Distinct()
            .OrderBy(y => y)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<string>> GetBidCommoditiesAsync(string tradeUnitCode, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode)
            .Select(b => b.CommodityCode)
            .Distinct()
            .OrderBy(c => c)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<int>> GetBidMonthsAsync(string tradeUnitCode, int cropYear, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocationBids
            .AsNoTracking()
            .Where(b => b.Location.TradeUnitCode == tradeUnitCode && b.CropYear == cropYear)
            .Select(b => b.Month)
            .Distinct()
            .OrderBy(m => m)
            .ToListAsync(cancellationToken);
    }

    public async Task<BidSheetLocationOrder?> GetLocationOrderAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocationOrders
            .AsNoTracking()
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TradeUnitKey == tradeUnitKey, cancellationToken);
    }

    public async Task SetLocationOrderAsync(string userId, string tradeUnitKey, string locationOrderJson, CancellationToken cancellationToken)
    {
        var existing = await _appContext.BidSheetLocationOrders
            .FirstOrDefaultAsync(r => r.UserId == userId && r.TradeUnitKey == tradeUnitKey, cancellationToken);

        if (existing is not null)
        {
            existing.LocationOrder = locationOrderJson;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        else
        {
            _appContext.BidSheetLocationOrders.Add(new BidSheetLocationOrder
            {
                UserId = userId,
                TradeUnitKey = tradeUnitKey,
                LocationOrder = locationOrderJson,
                ModifiedAt = DateTime.UtcNow
            });
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<BidSheetPreference?> GetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetPreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TradeUnitKey == tradeUnitKey, cancellationToken);
    }

    public async Task SetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear,
        string? cropOrder, string? hiddenCrops, string? selectedMonths, string? printLayout, CancellationToken cancellationToken)
    {
        var existing = await _appContext.BidSheetPreferences
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TradeUnitKey == tradeUnitKey, cancellationToken);

        if (existing is not null)
        {
            existing.CropCode = cropCode;
            existing.Month = month;
            existing.CropYear = cropYear;
            if (cropOrder is not null) existing.CropOrder = cropOrder;
            if (hiddenCrops is not null) existing.HiddenCrops = hiddenCrops;
            if (selectedMonths is not null) existing.SelectedMonths = selectedMonths;
            if (printLayout is not null) existing.PrintLayout = printLayout;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        else
        {
            _appContext.BidSheetPreferences.Add(new BidSheetPreference
            {
                UserId = userId,
                TradeUnitKey = tradeUnitKey,
                CropCode = cropCode,
                Month = month,
                CropYear = cropYear,
                CropOrder = cropOrder,
                HiddenCrops = hiddenCrops,
                SelectedMonths = selectedMonths,
                PrintLayout = printLayout,
                ModifiedAt = DateTime.UtcNow
            });
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>True when a DbUpdateException was caused by a unique-index/PK violation (SQL 2601/2627).</summary>
    private static bool IsUniqueViolation(DbUpdateException ex)
        => ex.InnerException is SqlException { Number: 2601 or 2627 };

    /// <summary>
    /// Recovers from a unique-constraint race on bid inserts: a concurrent request (or a retried
    /// request) already inserted a bid for the same (LocationId, CommodityCode, CropYear, Month).
    /// For each pending Added bid that now collides with a row in the DB, detach the insert and
    /// apply its value onto the existing row instead — so a re-save commits the whole batch (the
    /// user's value wins) rather than 500-ing. Returns true if anything was reconciled.
    /// </summary>
    private async Task<bool> ReconcileDuplicateBidInsertsAsync(CancellationToken cancellationToken)
    {
        var added = _appContext.ChangeTracker.Entries<BidSheetLocationBid>()
            .Where(e => e.State == EntityState.Added)
            .Select(e => e.Entity)
            .ToList();
        var reconciled = false;
        foreach (var bid in added)
        {
            // SQL Server's case-insensitive collation makes the CommodityCode compare match regardless of case.
            var existing = await _appContext.BidSheetLocationBids.FirstOrDefaultAsync(
                b => b.LocationId == bid.LocationId && b.CommodityCode == bid.CommodityCode
                     && b.CropYear == bid.CropYear && b.Month == bid.Month, cancellationToken);
            if (existing == null) continue;
            _appContext.Entry(bid).State = EntityState.Detached; // drop the duplicate insert
            reconciled = true;
            // If the row that won the race is feed-owned, it's read-only to users —
            // drop the colliding insert without applying the user's value.
            if (existing.Source == BidSources.Barchart) continue;
            existing.Bid = bid.Bid;
            existing.CommodityName = bid.CommodityName;
            existing.CommodityCategory = bid.CommodityCategory;
            existing.ModifiedBy = bid.CreatedBy;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        return reconciled;
    }
}
