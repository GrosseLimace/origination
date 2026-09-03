using GrainOriginatorPortal.Infrastructure.Abstractions;
using GrainOriginatorPortal.Infrastructure.Data;
using GrainOriginatorPortal.Infrastructure.Data.Entities;
using GrainOriginatorPortal.Infrastructure.Interfaces;
using Microsoft.EntityFrameworkCore;

namespace GrainOriginatorPortal.Infrastructure.Repositories;

/// <summary>
/// Reads the BarChart catalog for the picker. Everything here is a projection over
/// <c>dbo.vw_BarchartLocation</c> and the instrument/quote tables — no writes.
/// </summary>
public class BarchartCatalogRepository : IBarchartCatalogRepository
{
    private readonly ApplicationDbContext _appContext;

    public BarchartCatalogRepository(ApplicationDbContext appContext)
    {
        _appContext = appContext ?? throw new ArgumentNullException(nameof(appContext));
    }

    /// <inheritdoc />
    public async Task<List<BarchartLocationSummary>> SearchLocationsAsync(
        string? search,
        string? state,
        string? commodityCode,
        (double MinLat, double MaxLat, double MinLng, double MaxLng)? boundingBox,
        int take,
        CancellationToken cancellationToken = default)
    {
        var query = _appContext.BarchartLocationSummaries.AsQueryable();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim();
            // Originators search by whoever they know the site as — the company, the site name, or the town.
            query = query.Where(l =>
                (l.Elevator != null && l.Elevator.Contains(term)) ||
                (l.LocationName != null && l.LocationName.Contains(term)) ||
                (l.City != null && l.City.Contains(term)));
        }

        if (!string.IsNullOrWhiteSpace(state))
        {
            var st = state.Trim();
            query = query.Where(l => l.State == st);
        }

        if (!string.IsNullOrWhiteSpace(commodityCode))
        {
            var code = commodityCode.Trim();
            // "Publishes a bid that maps to this crop" — join through the mapping so the caller works in
            // Scoular codes and never has to know the vendor's commodity spelling.
            query = query.Where(l => _appContext.BarchartInstruments
                .Any(i => i.LocationKey == l.LocationKey
                       && i.IsActive
                       && !i.IsTest
                       && _appContext.BarchartCommodityMaps
                            .Any(m => m.BarchartCommodity == i.Commodity && m.IsActive && m.CommodityCode == code)));
        }

        if (boundingBox is { } box)
        {
            query = query.Where(l =>
                l.Latitude != null && l.Longitude != null &&
                l.Latitude >= box.MinLat && l.Latitude <= box.MaxLat &&
                l.Longitude >= box.MinLng && l.Longitude <= box.MaxLng);
        }

        // Busiest sites first: instrument count is a decent proxy for how much a location trades, so the
        // most useful candidates surface before the row cap bites. A radius search re-sorts by distance.
        return await query
            .OrderByDescending(l => l.ActiveInstrumentCount)
            .ThenBy(l => l.Elevator)
            .Take(take)
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<BarchartLocationSummary?> GetLocationAsync(
        string locationKey, CancellationToken cancellationToken = default)
        => await _appContext.BarchartLocationSummaries
            .FirstOrDefaultAsync(l => l.LocationKey == locationKey, cancellationToken);

    /// <inheritdoc />
    public async Task<Dictionary<string, decimal>> GetMatchedBidPricesAsync(
        IReadOnlyCollection<string> locationKeys, string commodityCode, int cropYear, int month, string instrumentType,
        CancellationToken cancellationToken = default)
    {
        if (locationKeys.Count == 0) return [];
        var today = DateTime.UtcNow.Date;

        // Same shape as GetBidPreviewAsync's per-location join, batched across every key the caller
        // asked about in one round trip instead of one per pin. instrumentType is NOT optional here
        // (GetBidPreviewAsync defaults it because it returns every type at once for a detail table) --
        // cash and basis are separate instruments with independent quotes, so leaving this filter off
        // let either one win the "first found" price per location, which is why this looked like it
        // ignored the cash/basis toggle entirely rather than showing the wrong one.
        var rows = await _appContext.BarchartInstruments
            .AsNoTracking()
            .Where(i => locationKeys.Contains(i.LocationKey)
                     && i.IsActive
                     && !i.IsTest
                     && i.InstrumentType == instrumentType
                     && i.DeliveryStart != null
                     && i.DeliveryStart.Value.Year == cropYear
                     && i.DeliveryStart.Value.Month == month
                     && (i.DeliveryEnd == null || i.DeliveryEnd >= today)
                     && _appContext.BarchartCommodityMaps
                        .Any(m => m.BarchartCommodity == i.Commodity && m.IsActive && m.CommodityCode == commodityCode))
            .Select(i => new
            {
                i.LocationKey,
                Price = _appContext.BarchartCurrentQuotes
                    .Where(q => q.Symbol == i.Symbol)
                    .Select(q => (decimal?)q.LastPrice)
                    .FirstOrDefault()
            })
            .Where(x => x.Price != null)
            .ToListAsync(cancellationToken);

        // One price per location: a site publishing this exact commodity/period through more than one
        // instrument is an edge case the map pin has no room to show twice, so first-found wins.
        var result = new Dictionary<string, decimal>();
        foreach (var row in rows)
        {
            if (!result.ContainsKey(row.LocationKey)) result[row.LocationKey] = row.Price!.Value;
        }
        return result;
    }

    /// <inheritdoc />
    public async Task<List<BarchartBidPreview>> GetBidPreviewAsync(
        string locationKey, string? instrumentType, CancellationToken cancellationToken = default)
    {
        // Same window rule as the bridge: a delivery month that has fully elapsed can't be delivered
        // into, so previewing a price for it would promise a cell that will never appear.
        var today = DateTime.UtcNow.Date;

        var instruments = _appContext.BarchartInstruments
            .AsNoTracking()
            .Where(i => i.LocationKey == locationKey
                     && i.IsActive
                     && !i.IsTest
                     && i.DeliveryStart != null
                     && (i.DeliveryEnd == null || i.DeliveryEnd >= today));

        if (!string.IsNullOrWhiteSpace(instrumentType))
        {
            var type = instrumentType.Trim();
            instruments = instruments.Where(i => i.InstrumentType == type);
        }

        // Left-joined deliberately: an unmapped commodity or a missing quote should still appear, marked,
        // rather than vanishing and leaving the user wondering why a bid they can see on the vendor's
        // site isn't listed.
        var rows = await instruments
            .Select(i => new BarchartBidPreview
            {
                VendorCommodity = i.Commodity ?? string.Empty,
                CommodityCode = _appContext.BarchartCommodityMaps
                    .Where(m => m.BarchartCommodity == i.Commodity && m.IsActive)
                    .Select(m => m.CommodityCode)
                    .FirstOrDefault(),
                IsMapped = _appContext.BarchartCommodityMaps
                    .Any(m => m.BarchartCommodity == i.Commodity && m.IsActive),
                IsBasis = i.InstrumentType == BarchartFeedDefaults.BasisInstrumentType,
                CropYear = i.DeliveryStart!.Value.Year,
                Month = i.DeliveryStart!.Value.Month,
                Symbol = i.Symbol,
                DeliveryWindowFlag = i.DeliveryWindowFlag,
                DeliveryStart = i.DeliveryStart,
                DeliveryEnd = i.DeliveryEnd,
                Price = _appContext.BarchartCurrentQuotes
                    .Where(q => q.Symbol == i.Symbol)
                    .Select(q => q.LastPrice)
                    .FirstOrDefault(),
                QuoteAsOf = _appContext.BarchartCurrentQuotes
                    .Where(q => q.Symbol == i.Symbol)
                    .Select(q => q.TradeTimestamp)
                    .FirstOrDefault()
            })
            .ToListAsync(cancellationToken);

        // The Bid Sheet holds one cell per commodity and delivery month, but a location can publish
        // several overlapping instruments for that month (whole-month plus first/last-half splits). The
        // bridge picks exactly one, so the preview applies the same ranking — otherwise the user is shown
        // two January corn rows and only ever gets one. Done in memory: this is a single location's bids.
        return rows
            .GroupBy(p => new { Cell = p.CommodityCode ?? p.VendorCommodity, p.CropYear, p.Month })
            .Select(g => g
                .OrderBy(p => p.DeliveryWindowFlag == null ? 0 : 1)
                .ThenByDescending(p => (p.DeliveryEnd - p.DeliveryStart) ?? TimeSpan.Zero)
                .ThenBy(p => p.DeliveryStart)
                .ThenByDescending(p => p.QuoteAsOf)
                .ThenBy(p => p.Symbol)
                .First())
            .OrderBy(p => p.CropYear)
            .ThenBy(p => p.Month)
            .ThenBy(p => p.VendorCommodity)
            .ToList();
    }

    /// <inheritdoc />
    public async Task<List<BarchartLocationPlacement>> GetPlacementsAsync(
        IReadOnlyCollection<string> locationKeys, CancellationToken cancellationToken = default)
    {
        if (locationKeys.Count == 0) return [];

        return await _appContext.BidSheetLocations
            .AsNoTracking()
            .Where(l => l.BarchartLocationKey != null && locationKeys.Contains(l.BarchartLocationKey))
            .Select(l => new BarchartLocationPlacement
            {
                LocationKey = l.BarchartLocationKey!,
                LocationId = l.Id,
                TradeUnitCode = l.TradeUnitCode,
                GroupName = l.GroupName,
                Name = l.Name
            })
            .ToListAsync(cancellationToken);
    }

    /// <inheritdoc />
    public async Task<bool> LocationExistsAsync(string locationKey, CancellationToken cancellationToken = default)
        => await _appContext.BarchartLocationSummaries
            .AnyAsync(l => l.LocationKey == locationKey, cancellationToken);

    /// <inheritdoc />
    public async Task<BarchartCoverage> GetCoverageAsync(CancellationToken cancellationToken = default)
    {
        var states = await _appContext.BarchartLocationSummaries
            .Where(l => l.State != null && l.State != "")
            .GroupBy(l => l.State!)
            .Select(g => new BarchartStateCoverage { State = g.Key, LocationCount = g.Count() })
            .OrderByDescending(s => s.LocationCount)
            .ThenBy(s => s.State)
            .ToListAsync(cancellationToken);

        var total = await _appContext.BarchartLocationSummaries.CountAsync(cancellationToken);
        var lastSeen = await _appContext.BarchartLocationSummaries
            .MaxAsync(l => (DateTime?)l.LastSeenUtc, cancellationToken);

        return new BarchartCoverage
        {
            LocationCount = total,
            LastRefreshedUtc = lastSeen,
            States = states
        };
    }
}
