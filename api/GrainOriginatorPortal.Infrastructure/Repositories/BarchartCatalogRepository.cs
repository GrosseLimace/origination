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

        // Every word must match SOMETHING, but not the same something. An originator names a site by
        // combining things that live in different columns -- "alliance belpre" is the company plus the
        // town, "belpre ks" the town plus the state -- and this used to be one Contains of the whole
        // phrase against one field at a time, so anything spanning two columns found nothing at all.
        //
        // Fields searched: the publishing company, the site name, the town, the state (by code OR full
        // name, since the catalog only stores codes and "kansas" would otherwise match nothing) and the
        // zip by prefix. Street address is deliberately out: a road name is not how anyone looks for an
        // elevator, and matching it would put "Main" hits in front of real ones.
        var terms = BarchartLocationSearch.ParseTerms(search);
        foreach (var parsed in terms)
        {
            // Copied per iteration so each predicate closes over its own values.
            var term = parsed.Text;
            var stateCode = parsed.StateCode;
            query = query.Where(l =>
                (l.Elevator != null && l.Elevator.Contains(term)) ||
                (l.LocationName != null && l.LocationName.Contains(term)) ||
                (l.City != null && l.City.Contains(term)) ||
                (l.ZipCode != null && l.ZipCode.StartsWith(term)) ||
                (stateCode != null && l.State == stateCode));
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
        //
        // With a search typed, a site whose name or town contains the WHOLE phrase leads: searching
        // "alliance ag" should put Alliance Ag & Grain above a busier elevator that happens to sit in a
        // town called Alliance. Only ranking changes -- both still match, and the row cap is what makes
        // the difference visible.
        var phrase = terms.Count > 1 ? search!.Trim() : null;
        var ordered = phrase == null
            ? query.OrderByDescending(l => l.ActiveInstrumentCount)
            : query
                .OrderByDescending(l => (l.Elevator != null && l.Elevator.Contains(phrase))
                                     || (l.LocationName != null && l.LocationName.Contains(phrase))
                                     || (l.City != null && l.City.Contains(phrase)))
                .ThenByDescending(l => l.ActiveInstrumentCount);

        return await ordered
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
    public async Task<Dictionary<string, BarchartMatchedPrice>> GetMatchedBidPricesAsync(
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
                i.UnderlyingFuture,
                Price = _appContext.BarchartCurrentQuotes
                    .Where(q => q.Symbol == i.Symbol)
                    .Select(q => (decimal?)q.LastPrice)
                    .FirstOrDefault()
            })
            .Where(x => x.Price != null)
            .ToListAsync(cancellationToken);

        // One price per location: a site publishing this exact commodity/period through more than one
        // instrument is an edge case the map pin has no room to show twice, so first-found wins.
        var result = new Dictionary<string, BarchartMatchedPrice>();
        foreach (var row in rows)
        {
            if (!result.ContainsKey(row.LocationKey))
            {
                result[row.LocationKey] = new BarchartMatchedPrice
                {
                    Price = row.Price!.Value,
                    UnderlyingFuture = row.UnderlyingFuture
                };
            }
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
        // IsBasis belongs in the KEY, not just the ranking. Cash and basis are separate instruments
        // with independent quotes for the same commodity and month, so grouping without it collapsed
        // the pair into a single row and left the tie-break to decide which one survived -- and the
        // last tie-break is the symbol, where ZCB... sorts ahead of ZCP..., so basis won nearly every
        // group. The caller was handed a list it could not answer a Cash/Basis/Both toggle from: on the
        // Dev catalog 3,720 of 3,988 locations had no cash row left at all.
        return rows
            .GroupBy(p => new { Cell = p.CommodityCode ?? p.VendorCommodity, p.CropYear, p.Month, p.IsBasis })
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
            .ThenBy(p => p.IsBasis) // cash first, so a paired row reads cash-then-basis
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
        // The newest quote write is when the pipeline last delivered prices (every quote in a load gets
        // this stamp, whether or not the elevator's number moved), which is what "bids updated" means.
        var pricesRefreshed = await _appContext.BarchartCurrentQuotes
            .MaxAsync(q => (DateTime?)q.UpdatedAtUtc, cancellationToken);

        return new BarchartCoverage
        {
            LocationCount = total,
            LastRefreshedUtc = lastSeen,
            PricesRefreshedUtc = pricesRefreshed,
            States = states
        };
    }
}
