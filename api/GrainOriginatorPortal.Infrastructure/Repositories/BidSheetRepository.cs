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

    public async Task<BidSheetLocation> CreateLocationAsync(BidSheetLocation location, CancellationToken cancellationToken)
    {
        _appContext.BidSheetLocations.Add(location);
        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Either a child bid collided with a concurrently-inserted one (reconcilable — the
            // user's value wins), or the location NAME itself lost a race. A name collision is
            // deliberately not reconciled here: adopting someone else's location would silently
            // attach this caller's bids to a row they never chose. The service pre-checks the name,
            // so reaching this is the narrow race window; rethrow and let the caller retry into the
            // clean "already exists" validation error.
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
            // As in CreateLocationAsync: a colliding child bid reconciles, a rename onto an
            // already-taken name does not — that has to surface rather than pick a winner.
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
            .Where(b => b.LocationId == locationId && b.CommodityCode == commodityCode);
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

        // Single SaveChanges to persist all new locations and get their IDs. If a concurrent bulk
        // upsert created one of the same locations first, adopt the row that won and re-save —
        // otherwise this bare save threw and took the entire batch of bids down with it.
        if (newLocations.Count > 0)
        {
            try
            {
                await _appContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException ex) when (IsUniqueViolation(ex))
            {
                _logger.LogWarning(ex, "Bulk bid upsert hit a location unique-constraint race — reconciling");
                if (await ReconcileDuplicateLocationInsertsAsync(tradeUnitCode, newLocations, byName, byElevator, cancellationToken))
                    await _appContext.SaveChangesAsync(cancellationToken);
                else throw;
            }
        }

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
                // Empty bid = user cleared the input → delete the existing row if present
                if (bidLookup.TryGetValue(key, out var toRemove))
                {
                    _appContext.BidSheetLocationBids.Remove(toRemove);
                    bidLookup.Remove(key);
                }
            }
            else if (bidLookup.TryGetValue(key, out var bid))
            {
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
    /// Recovers from a unique-constraint race on LOCATION inserts: a concurrent bulk upsert already
    /// created a location with the same (Name, TradeUnitCode). Detaches our duplicate insert and
    /// rewrites the caller's lookups to point at the row that won, so the surrounding batch can
    /// re-save instead of losing every bid in it. Returns true if anything was reconciled.
    /// </summary>
    private async Task<bool> ReconcileDuplicateLocationInsertsAsync(
        string tradeUnitCode,
        List<BidSheetLocation> newLocations,
        Dictionary<string, BidSheetLocation> byName,
        Dictionary<string, BidSheetLocation> byElevator,
        CancellationToken cancellationToken)
    {
        var added = _appContext.ChangeTracker.Entries<BidSheetLocation>()
            .Where(e => e.State == EntityState.Added)
            .Select(e => e.Entity)
            .ToList();
        if (added.Count == 0) return false;

        var names = added.Select(l => l.Name.Trim()).ToList();
        // Case-insensitive compare matches the collation behind UQ_BidSheetLocations_Name_TradeUnit.
        var winners = await _appContext.BidSheetLocations
            .Where(l => l.TradeUnitCode == tradeUnitCode && names.Contains(l.Name))
            .ToListAsync(cancellationToken);
        if (winners.Count == 0) return false;

        var winnerByName = new Dictionary<string, BidSheetLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var w in winners)
            winnerByName.TryAdd(w.Name.Trim(), w);

        var reconciled = false;
        foreach (var dup in added)
        {
            var name = dup.Name.Trim();
            if (!winnerByName.TryGetValue(name, out var winner)) continue;

            _appContext.Entry(dup).State = EntityState.Detached; // drop our losing insert
            // Swap, don't just remove: the caller derives the set of location ids to preload
            // existing bids for from this list, so dropping the entry without substituting the
            // winner would hide that location's already-stored bids and send the second pass into
            // an avoidable unique-violation retry.
            newLocations.Remove(dup);
            newLocations.Add(winner);
            byName[name] = winner;
            if (!string.IsNullOrEmpty(dup.ElevatorCode))
                byElevator[dup.ElevatorCode!] = winner;
            reconciled = true;
        }

        return reconciled;
    }

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
        if (added.Count == 0) return false;

        // One query for the whole pending set, not one per bid. This runs over EVERY Added bid —
        // not just the one that tripped the constraint — so on a large bulk upsert (locations ×
        // commodities × months) the per-bid version fanned out to a round trip per pending insert
        // while the user waited on a retry. Narrowed to the affected locations and crop years,
        // which is selective enough to stay on the index without building an N-term OR.
        var locationIds = added.Select(b => b.LocationId).Distinct().ToList();
        var cropYears = added.Select(b => b.CropYear).Distinct().ToList();
        var candidates = await _appContext.BidSheetLocationBids
            .Where(b => locationIds.Contains(b.LocationId) && cropYears.Contains(b.CropYear))
            .ToListAsync(cancellationToken);

        // Uppercase the CommodityCode on both sides of the key: SQL Server's collation is
        // case-insensitive, so "yc" and "YC" are the same row to the unique index and must be the
        // same key here too — otherwise a case difference looks like "no collision" and the
        // duplicate insert is retried straight back into the same violation.
        var existingByKey = new Dictionary<(int, string, int, int), BidSheetLocationBid>();
        foreach (var b in candidates)
            existingByKey.TryAdd((b.LocationId, (b.CommodityCode ?? "").ToUpperInvariant(), b.CropYear, b.Month), b);

        var reconciled = false;
        foreach (var bid in added)
        {
            var key = (bid.LocationId, (bid.CommodityCode ?? "").ToUpperInvariant(), bid.CropYear, bid.Month);
            if (!existingByKey.TryGetValue(key, out var existing)) continue;
            _appContext.Entry(bid).State = EntityState.Detached; // drop the duplicate insert
            existing.Bid = bid.Bid;
            existing.CommodityName = bid.CommodityName;
            existing.CommodityCategory = bid.CommodityCategory;
            existing.ModifiedBy = bid.CreatedBy;
            existing.ModifiedAt = DateTime.UtcNow;
            reconciled = true;
        }
        return reconciled;
    }
}
