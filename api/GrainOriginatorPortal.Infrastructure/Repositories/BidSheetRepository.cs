using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using GrainOriginatorPortal.Infrastructure.Exceptions;

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

    public async Task<List<BidSheetLocation>> GetAllLocationsAsync(CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .Include(l => l.Bids)
            .OrderBy(l => l.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<string?> GetLocationCreatedByAsync(int id, CancellationToken cancellationToken) =>
        await _appContext.BidSheetLocations
            .AsNoTracking()
            .Where(l => l.Id == id)
            .Select(l => l.CreatedBy)
            .FirstOrDefaultAsync(cancellationToken);

    public Task<bool> LocationNameExistsAsync(string name, CancellationToken cancellationToken)
    {
        var trimmed = name.Trim();
        // Global now -- a location is one company-wide row, so "already taken" no longer has a desk
        // to scope by.
        //
        // ⚠ There is NO unique index backing this. The old UQ_BidSheetLocations_Name_TradeUnit was
        // scoped by trade unit and is gone from the model; a global equivalent needs a duplicate-name
        // sweep of QA/PROD first (the table predates any name rule by years, and a unique index over
        // existing duplicates fails the deploy). This check is a courtesy message, not a guarantee --
        // a race between two concurrent creates of the same name both succeed. Pre-existing gap, not
        // introduced here.
        return _appContext.BidSheetLocations
            .AnyAsync(l => l.Name == trimmed, cancellationToken);
    }

    public Task<bool> BarchartLocationLinkedAsync(string barchartLocationKey, CancellationToken cancellationToken) =>
        _appContext.BidSheetLocations
            .AnyAsync(l => l.BarchartLocationKey == barchartLocationKey, cancellationToken);

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
            // Either a child bid collided with a concurrently-inserted one (reconcilable — the
            // user's value wins), or the location NAME itself lost a race. A name collision is
            // deliberately not reconciled here: adopting someone else's location would silently
            // attach this caller's bids to a row they never chose. The service pre-checks the name,
            // so reaching this is the narrow race window; rethrow and let the caller retry into the
            // clean "already exists" validation error.
            _logger.LogWarning(ex, "CreateBidSheetLocation hit a unique-constraint race — reconciling");
            if (await ReconcileDuplicateBidInsertsAsync(cancellationToken))
            {
                await _appContext.SaveChangesAsync(cancellationToken);
            }
            else
            {
                // Nothing to reconcile means the LOCATION itself collided, not one of its bids — the
                // placement already exists on this trade unit. The bulk BarChart add posts locations
                // with no bids and fires its creates in parallel, so two for the same listing both pass
                // the pre-check and the second lands here. Signalled distinctly so the service can
                // answer 400 like the serialized path does, instead of a 500 the client reads as a real
                // failure rather than "already added".
                _appContext.Entry(location).State = EntityState.Detached;
                throw new DuplicateLocationException(
                    "This location is already on that trade unit.", ex);
            }
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
        if (existing == null) return;

        // Take it off every sheet that holds it, in the same transaction as the delete.
        //
        // The link FK is RESTRICT on purpose, so no other code path can empty somebody else's sheet
        // as a side effect. This path is the one place that is allowed to, and only because the user
        // was shown the sheet count and confirmed. Doing it explicitly here rather than by cascade
        // keeps that intent readable: a cascade would make every future delete silent.
        var links = await _appContext.BidSheetLocationLinks
            .Where(l => l.BidSheetLocationId == id)
            .ToListAsync(cancellationToken);
        if (links.Count > 0) _appContext.BidSheetLocationLinks.RemoveRange(links);

        _appContext.BidSheetLocations.Remove(existing);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteBidsAsync(int locationId, string commodityCode, int? month, CancellationToken cancellationToken)
    {
        var query = _appContext.BidSheetLocationBids
            // Fed rows go too: the bridge re-creates whatever it still publishes on its next run.
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

    public async Task BulkUpsertBidsAsync(IEnumerable<BidUpsertInput> requests, string userId, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var requestList = requests.ToList();

        // Resolve every input to a location BEFORE writing anything, and refuse the whole batch if any
        // of them cannot be placed.
        //
        // This used to load one trade unit's locations, match on elevator code then on name, and CREATE
        // a location when it found none. That was safe only because the trade unit made the name lookup
        // deterministic and a unique (Name, TradeUnitCode) index made it unique. Locations are
        // company-wide now: the same match would reach across the whole company, and a typo would
        // quietly fork a new global row that everyone then sees. So the id is what counts, a name is a
        // fallback for callers that have none, and an input that resolves to nothing is an error rather
        // than an invention.
        var wantedIds = requestList.Where(r => r.LocationId.HasValue)
                                   .Select(r => r.LocationId!.Value)
                                   .ToHashSet();
        var wantedNames = requestList.Where(r => !r.LocationId.HasValue && !string.IsNullOrWhiteSpace(r.Name))
                                     .Select(r => r.Name!.Trim())
                                     .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var wantedElevators = requestList.Where(r => !r.LocationId.HasValue && !string.IsNullOrWhiteSpace(r.ElevatorCode))
                                         .Select(r => r.ElevatorCode!)
                                         .ToHashSet();

        var candidates = await _appContext.BidSheetLocations
            .Where(l => wantedIds.Contains(l.Id)
                     || wantedNames.Contains(l.Name)
                     || (l.ElevatorCode != null && wantedElevators.Contains(l.ElevatorCode)))
            .ToListAsync(cancellationToken);

        var byId = candidates.ToDictionary(l => l.Id);
        var byElevator = new Dictionary<string, BidSheetLocation>();
        foreach (var l in candidates.Where(l => !string.IsNullOrEmpty(l.ElevatorCode)))
            byElevator.TryAdd(l.ElevatorCode!, l);
        // Lowest id wins a name tie, so the choice is at least stable rather than arbitrary.
        var byName = new Dictionary<string, BidSheetLocation>(StringComparer.OrdinalIgnoreCase);
        foreach (var l in candidates.OrderBy(l => l.Id))
            byName.TryAdd(l.Name.Trim(), l);

        BidSheetLocation? Resolve(BidUpsertInput req)
        {
            if (req.LocationId.HasValue) return byId.GetValueOrDefault(req.LocationId.Value);
            if (!string.IsNullOrEmpty(req.ElevatorCode) && byElevator.TryGetValue(req.ElevatorCode, out var byElev))
                return byElev;
            if (!string.IsNullOrWhiteSpace(req.Name) && byName.TryGetValue(req.Name.Trim(), out var byNm))
                return byNm;
            return null;
        }

        // Loud, not silent. A dropped bid is invisible: the save reports success and the value simply
        // is not there the next time the user looks.
        var unresolved = requestList.Where(r => Resolve(r) is null).ToList();
        if (unresolved.Count > 0)
        {
            var first = unresolved[0];
            var which = first.LocationId.HasValue ? $"id {first.LocationId}" : $"named {first.Name}";
            throw new BidSheetLocationNotFoundException(
                $"Could not find the location for {unresolved.Count} bid(s); the first is {which}. "
                + "Refresh the sheet and try again.");
        }

        // Batch-load all existing bids for the affected locations (1 query instead of N)
        var locationIds = candidates.Select(l => l.Id).ToHashSet();
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
            // Never null: the guard above rejected the batch if anything failed to resolve.
            var loc = Resolve(req)!;

            var key = (loc.Id, (req.CommodityCode ?? "").ToUpperInvariant(), req.CropYear, req.Month);
            if (string.IsNullOrWhiteSpace(req.Bid) && string.IsNullOrWhiteSpace(req.BasisBid))
            {
                // BOTH prices cleared = user emptied the cell → delete the existing row if present.
                // Either one alone is legitimate: plenty of elevators are quoted on basis only, and
                // deleting on an empty cash would throw the basis away with it.
                // Fed cells clear too. The next bridge run re-inserts them, so this is an override
                // that lasts until tomorrow rather than a permanent delete.
                if (bidLookup.TryGetValue(key, out var toRemove))
                {
                    _appContext.BidSheetLocationBids.Remove(toRemove);
                    bidLookup.Remove(key);
                }
            }
            else if (bidLookup.TryGetValue(key, out var bid))
            {
                // A user may override a fed cell. Ownership moves with the value: the row becomes
                // Manual so the sheet shows it as hand-typed, and the bridge's next run takes it
                // back. That round trip is the feature -- an originator can correct a price today
                // and the vendor reasserts tomorrow if they were wrong.
                bid.Source = BidSources.Manual;
                bid.Bid = req.Bid;
                bid.BasisBid = string.IsNullOrWhiteSpace(req.BasisBid) ? null : req.BasisBid;
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
                    BasisBid = string.IsNullOrWhiteSpace(req.BasisBid) ? null : req.BasisBid,
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

    public async Task<BidSheetPreference?> GetPreferenceAsync(string userId, string tradeUnitKey, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetPreferences
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.UserId == userId && p.TradeUnitKey == tradeUnitKey, cancellationToken);
    }

    public async Task SetPreferenceAsync(string userId, string tradeUnitKey, string? cropCode, int? month, int? cropYear,
        string? cropOrder, string? hiddenCrops, string? selectedMonths, string? selectedYears, string? printLayout, string? priceMode,
        string? selectedBidSheetIds, CancellationToken cancellationToken)
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
            if (selectedYears is not null) existing.SelectedYears = selectedYears;
            if (printLayout is not null) existing.PrintLayout = printLayout;
            if (priceMode is not null) existing.PriceMode = priceMode;
            if (selectedBidSheetIds is not null) existing.SelectedBidSheetIds = selectedBidSheetIds;
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
                SelectedYears = selectedYears,
                PrintLayout = printLayout,
                PriceMode = priceMode,
                SelectedBidSheetIds = selectedBidSheetIds,
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
            reconciled = true;
            // A user write beats a fed row here too, and takes ownership with it.
            //
            // BasisBid travels with Bid. Most manual bids ARE a basis -- that is where the migration
            // put them -- so copying only the cash side lost the single value the user typed and left
            // whatever basis was on the row, possibly the feed's.
            existing.Source = BidSources.Manual;
            existing.Bid = bid.Bid;
            existing.BasisBid = bid.BasisBid;
            existing.CommodityName = bid.CommodityName;
            existing.CommodityCategory = bid.CommodityCategory;
            existing.ModifiedBy = bid.CreatedBy;
            existing.ModifiedAt = DateTime.UtcNow;
        }
        return reconciled;
    }

    // =============================================================================================
    // Sheets
    // =============================================================================================

    /// <summary>
    /// Owner OR shared-with, where "shared-with" now means any of four things. This one predicate is
    /// the whole visibility rule; every sheet read goes through it, so there is no second place to keep
    /// in step and no way for a caller to reach a sheet that this did not admit.
    /// </summary>
    /// <remarks>
    /// Membership is re-resolved on every read rather than stored: a new hire on desk 2190 sees the
    /// sheet shared with 2190 without anyone editing it, and somebody who moves desks stops seeing it.
    ///
    /// The recap-group arm is the caller's OWN group ids, resolved before this runs
    /// (<see cref="BidSheetAccess.RecapGroupIds"/>) rather than joined here. Membership of a recap group
    /// is itself people/units/groups, so doing it inline would nest a second EXISTS over
    /// DailyRecapGroupMembers inside this one and the whole predicate would stop translating cleanly.
    ///
    /// Every arm is an equality test against a pre-computed list, so an EMPTY list matches nothing --
    /// which is exactly what makes <see cref="BidSheetAccess.OwnerAndSelfOnly"/> safe to degrade to.
    /// </remarks>
    private static IQueryable<BidSheet> VisibleTo(IQueryable<BidSheet> query, BidSheetAccess access) =>
        query.Where(s =>
            s.OwnerUserId == access.PersonId
            || s.Shares.Any(sh =>
                   (sh.MemberType == BidSheetShareTypes.Person && sh.MemberId == access.PersonId)
                || (sh.MemberType == BidSheetShareTypes.TradeUnit && access.TradeUnitCodes.Contains(sh.MemberId))
                || (sh.MemberType == BidSheetShareTypes.TradeUnitGroup && access.GroupIds.Contains(sh.MemberId))
                || (sh.MemberType == BidSheetShareTypes.RecapGroup && access.RecapGroupIds.Contains(sh.MemberId))));

    /// <summary>Shares, links, and the location behind each link with its bids -- everything the
    /// screen needs to render a sheet without a second round trip.</summary>
    private static IQueryable<BidSheet> WithContents(IQueryable<BidSheet> query) =>
        query.Include(s => s.Shares)
             .Include(s => s.Locations.OrderBy(l => l.SortOrder))
                 .ThenInclude(l => l.Location!)
                     .ThenInclude(loc => loc.Bids);

    public async Task<List<BidSheet>> GetVisibleSheetsAsync(BidSheetAccess access, CancellationToken cancellationToken)
    {
        return await WithContents(VisibleTo(_appContext.BidSheets.AsNoTracking(), access))
            .OrderBy(s => s.Name)
            .ToListAsync(cancellationToken);
    }

    public async Task<BidSheet?> GetVisibleSheetAsync(int sheetId, BidSheetAccess access, CancellationToken cancellationToken)
    {
        return await WithContents(VisibleTo(_appContext.BidSheets.AsNoTracking(), access))
            .FirstOrDefaultAsync(s => s.Id == sheetId, cancellationToken);
    }

    /// <summary>
    /// The Daily Recap group ids this caller is in — the second hop the visibility predicate can't do
    /// itself. Mirrors DailyRecapGroupRepository's own visibility rule (created it, or a member by
    /// person / trade-unit / trade-unit-group), so "groups I'm in" means the same thing on both screens.
    /// </summary>
    public async Task<List<string>> GetCallerRecapGroupIdsAsync(
        string callerUpn, string personId, IReadOnlyCollection<string> tradeUnitCodes,
        IReadOnlyCollection<string> groupIds, CancellationToken cancellationToken)
    {
        var ids = await _appContext.DailyRecapGroups.AsNoTracking()
            .Where(g => g.CreatedBy == callerUpn
                     || g.Members.Any(m =>
                            (m.MemberType == "person" && m.MemberId == personId)
                         || (m.MemberType == "trade-unit" && tradeUnitCodes.Contains(m.MemberId))
                         || (m.MemberType == "trade-unit-group" && groupIds.Contains(m.MemberId))))
            .Select(g => g.Id)
            .ToListAsync(cancellationToken);
        return ids.Select(id => id.ToString()).ToList();
    }

    public async Task<bool> SheetExistsAsync(int sheetId, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheets.AsNoTracking().AnyAsync(s => s.Id == sheetId, cancellationToken);
    }

    public async Task<bool> SheetNameExistsAsync(string ownerUserId, string name, int? excludeSheetId, CancellationToken cancellationToken)
    {
        var trimmed = (name ?? string.Empty).Trim();
        return await _appContext.BidSheets
            .AsNoTracking()
            .AnyAsync(s => s.OwnerUserId == ownerUserId
                        && s.Name == trimmed
                        && (excludeSheetId == null || s.Id != excludeSheetId), cancellationToken);
    }

    public async Task<BidSheet> CreateSheetAsync(BidSheet sheet, CancellationToken cancellationToken)
    {
        _appContext.BidSheets.Add(sheet);
        await _appContext.SaveChangesAsync(cancellationToken);
        return sheet;
    }

    public async Task<BidSheet?> RenameSheetAsync(int sheetId, string name, string modifiedBy, CancellationToken cancellationToken)
    {
        var sheet = await _appContext.BidSheets.FirstOrDefaultAsync(s => s.Id == sheetId, cancellationToken);
        if (sheet == null) return null;
        sheet.Name = name.Trim();
        sheet.ModifiedBy = modifiedBy;
        sheet.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);
        return sheet;
    }

    public async Task<BidSheet?> SetSheetLayoutAsync(int sheetId, string? cropOrder, string? hiddenCrops,
        string? selectedMonths, string? selectedYears, string modifiedBy, CancellationToken cancellationToken)
    {
        var sheet = await _appContext.BidSheets.FirstOrDefaultAsync(s => s.Id == sheetId, cancellationToken);
        if (sheet == null) return null;

        // null means "not sent". The screen saves crop order, hidden crops, months and years on four
        // separate interactions and must not blank the other three each time.
        if (cropOrder != null) sheet.CropOrder = cropOrder;
        if (hiddenCrops != null) sheet.HiddenCrops = hiddenCrops;
        if (selectedMonths != null) sheet.SelectedMonths = selectedMonths;
        if (selectedYears != null) sheet.SelectedYears = selectedYears;

        sheet.ModifiedBy = modifiedBy;
        sheet.ModifiedAt = DateTime.UtcNow;
        await _appContext.SaveChangesAsync(cancellationToken);
        return sheet;
    }

    public async Task DeleteSheetAsync(int sheetId, CancellationToken cancellationToken)
    {
        var sheet = await _appContext.BidSheets.FirstOrDefaultAsync(s => s.Id == sheetId, cancellationToken);
        if (sheet == null) return;
        // Cascade takes the shares and the location links. The locations are company-wide; they stay.
        _appContext.BidSheets.Remove(sheet);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<string?> GetSheetOwnerAsync(int sheetId, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheets
            .AsNoTracking()
            .Where(s => s.Id == sheetId)
            .Select(s => s.OwnerUserId)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<BidSheet?> SetSheetSharesAsync(int sheetId, List<BidSheetShare> shares, CancellationToken cancellationToken)
    {
        var sheet = await _appContext.BidSheets
            .Include(s => s.Shares)
            .FirstOrDefaultAsync(s => s.Id == sheetId, cancellationToken);
        if (sheet == null) return null;

        // Sharing a sheet with its own owner is a no-op, not a row -- the owner already sees it, and
        // storing it would make the list read as if they had been invited to a sheet they created.
        // Only the PERSON share can be the owner; a desk or group that happens to contain them is a
        // genuinely different audience and must survive.
        // De-duplicating on type+id, not id alone: desk "2190" and a person id "2190" are different
        // members, and collapsing them would silently drop one (and hit the unique index either way).
        // Case-insensitive so "cegr" and "CEgr" do not both land.
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            $"{BidSheetShareTypes.Person}|{sheet.OwnerUserId}"
        };
        var kept = new List<BidSheetShare>();
        foreach (var share in shares)
        {
            if (string.IsNullOrWhiteSpace(share.MemberId)) continue;
            // Unknown discriminators are dropped rather than stored: the visibility predicate only
            // matches the four it knows, so an unrecognised row could never grant access anyway -- but
            // it WOULD sit in the list looking like somebody had been given some.
            if (!BidSheetShareTypes.IsKnown(share.MemberType)) continue;
            if (!seen.Add($"{share.MemberType}|{share.MemberId.Trim()}")) continue;
            share.BidSheetId = sheetId;
            kept.Add(share);
        }

        _appContext.BidSheetShares.RemoveRange(sheet.Shares);
        sheet.Shares = kept;
        await _appContext.SaveChangesAsync(cancellationToken);
        return sheet;
    }

    public async Task<BidSheetLocationLink> AddSheetLocationAsync(int sheetId, int locationId, string addedBy, CancellationToken cancellationToken)
    {
        var existing = await _appContext.BidSheetLocationLinks
            .FirstOrDefaultAsync(l => l.BidSheetId == sheetId && l.BidSheetLocationId == locationId, cancellationToken);
        if (existing != null) return existing;

        var nextOrder = await _appContext.BidSheetLocationLinks
            .Where(l => l.BidSheetId == sheetId)
            .Select(l => (int?)l.SortOrder)
            .MaxAsync(cancellationToken) ?? -1;

        var link = new BidSheetLocationLink
        {
            BidSheetId = sheetId,
            BidSheetLocationId = locationId,
            SortOrder = nextOrder + 1,
            AddedBy = addedBy,
            AddedAt = DateTime.UtcNow
        };
        _appContext.BidSheetLocationLinks.Add(link);

        try
        {
            await _appContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // Two people added the same elevator between the check above and this write. That is the
            // outcome they both wanted, so return the row that won instead of surfacing an error.
            _appContext.Entry(link).State = EntityState.Detached;
            var winner = await _appContext.BidSheetLocationLinks
                .FirstOrDefaultAsync(l => l.BidSheetId == sheetId && l.BidSheetLocationId == locationId, cancellationToken);
            if (winner == null) throw;
            return winner;
        }

        return link;
    }

    public async Task RemoveSheetLocationAsync(int sheetId, int locationId, CancellationToken cancellationToken)
    {
        var link = await _appContext.BidSheetLocationLinks
            .FirstOrDefaultAsync(l => l.BidSheetId == sheetId && l.BidSheetLocationId == locationId, cancellationToken);
        if (link == null) return;
        _appContext.BidSheetLocationLinks.Remove(link);
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> RemoveSheetLocationsAsync(int sheetId, IReadOnlyCollection<int> locationIds, CancellationToken cancellationToken)
    {
        if (locationIds.Count == 0) return 0;

        var links = await _appContext.BidSheetLocationLinks
            .Where(l => l.BidSheetId == sheetId && locationIds.Contains(l.BidSheetLocationId))
            .ToListAsync(cancellationToken);
        if (links.Count == 0) return 0;

        // One SaveChanges, so a multi-select either comes off the sheet entirely or not at all. Doing
        // it as N single removes could half-fail and leave the user guessing which ones went.
        //
        // Only the LINKS go. The locations are company-wide and other sheets may hold them, which is
        // why the link->location FK is Restrict: this can never take an elevator away from anybody.
        // SortOrder gaps are left behind on purpose -- only the relative order is ever read.
        _appContext.BidSheetLocationLinks.RemoveRange(links);
        await _appContext.SaveChangesAsync(cancellationToken);
        return links.Count;
    }

    public async Task SetSheetLocationNameAsync(int sheetId, int locationId, string? displayName, CancellationToken cancellationToken)
    {
        var link = await _appContext.BidSheetLocationLinks
            .FirstOrDefaultAsync(l => l.BidSheetId == sheetId && l.BidSheetLocationId == locationId, cancellationToken);
        // Not on this sheet, nothing to name. Silent like RemoveSheetLocationAsync above: the caller is
        // already authorized for the sheet, so this is a stale client rather than an access problem.
        if (link == null) return;
        link.DisplayName = displayName;
        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task SetSheetLocationOrderAsync(int sheetId, IReadOnlyList<int> orderedLocationIds, CancellationToken cancellationToken)
    {
        var links = await _appContext.BidSheetLocationLinks
            .Where(l => l.BidSheetId == sheetId)
            .ToListAsync(cancellationToken);
        if (links.Count == 0) return;

        var position = new Dictionary<int, int>();
        for (var i = 0; i < orderedLocationIds.Count; i++)
            position.TryAdd(orderedLocationIds[i], i);

        // Anything the client did not mention keeps its relative order AFTER everything it did. A
        // client that loaded before a colleague added a row would otherwise renumber that row to the
        // front on the next drag; the old per-user JSON order dropped unknown ids entirely.
        var next = orderedLocationIds.Count;
        foreach (var link in links.OrderBy(l => l.SortOrder))
        {
            link.SortOrder = position.TryGetValue(link.BidSheetLocationId, out var at) ? at : next++;
        }

        await _appContext.SaveChangesAsync(cancellationToken);
    }

    public async Task<int> CountSheetsHoldingLocationAsync(int locationId, CancellationToken cancellationToken)
    {
        return await _appContext.BidSheetLocationLinks
            .AsNoTracking()
            .Where(l => l.BidSheetLocationId == locationId)
            .Select(l => l.BidSheetId)
            .Distinct()
            .CountAsync(cancellationToken);
    }
}
