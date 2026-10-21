namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>One BarChart elevator listing as the picker sees it.</summary>
public record BarchartCatalogLocationResponse
{
    /// <summary>Vendor location key — the value stored on a Bid Sheet location to link it to the feed.</summary>
    public string LocationKey { get; init; } = string.Empty;

    /// <summary>Company that owns the site, e.g. "Golden Grain Energy".</summary>
    public string? Elevator { get; init; }

    /// <summary>Site name, which is usually the more recognizable of the two.</summary>
    public string? LocationName { get; init; }

    public string? FacilityType { get; init; }
    public string? Address { get; init; }
    public string? City { get; init; }
    public string? State { get; init; }
    public string? ZipCode { get; init; }
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public string? Phone { get; init; }
    public string? Website { get; init; }

    /// <summary>Active instruments (commodity × delivery window) this site publishes.</summary>
    public int InstrumentCount { get; init; }

    /// <summary>Distinct commodities this site publishes.</summary>
    public int CommodityCount { get; init; }

    /// <summary>When the elevator last updated any of its bids — the freshness signal shown in the list.</summary>
    public DateTime? LatestQuoteAsOf { get; init; }

    /// <summary>Distance from the searched map centre, in miles. Null when the search wasn't geographic.</summary>
    public double? DistanceMiles { get; init; }

    /// <summary>Trade units this location is already on, so the picker can show "already added" state.</summary>
    public List<BarchartCatalogPlacementResponse> Placements { get; init; } = [];

    /// <summary>
    /// This location's price for the search's CommodityCode/CropYear/Month, when the search asked for
    /// one and this location has one. Null either because the search didn't ask (no crop/period filter
    /// in play) or because this specific location has nothing published for that exact period -- the
    /// two look the same on the wire and the caller already knows which one it asked for.
    /// </summary>
    public decimal? MatchedBidPrice { get; init; }

    /// <summary>
    /// Futures contract MatchedBidPrice is quoted against, e.g. "ZCU26". Null whenever MatchedBidPrice
    /// is, and also when the vendor published the instrument without one. The map prints it beside the
    /// price the same way it does for an added location's bid -- two elevators quoting the same
    /// delivery month can be on different exchanges, so the number alone isn't a like-for-like compare.
    /// </summary>
    public string? MatchedBidBoard { get; init; }

    /// <summary>
    /// When the elevator last updated MatchedBidPrice, UTC. Null whenever MatchedBidPrice is. The map
    /// hides a price older than the coverage response's StaleAfterDays behind "--" and prints this date.
    /// </summary>
    public DateTime? MatchedBidAsOf { get; init; }
}

/// <summary>Where a catalog listing already sits on the Bid Sheet.</summary>
public record BarchartCatalogPlacementResponse
{
    /// <summary>Bid Sheet location id — what you'd call the delete endpoint with to remove the placement.</summary>
    public int LocationId { get; init; }
    public string TradeUnitCode { get; init; } = string.Empty;
    public string? GroupName { get; init; }
    public string Name { get; init; } = string.Empty;
}

/// <summary>A listing plus the bids it currently publishes.</summary>
public record BarchartCatalogLocationDetailResponse
{
    public BarchartCatalogLocationResponse Location { get; init; } = new();

    /// <summary>Preview of what would land on the Bid Sheet if this location were added.</summary>
    public List<BarchartCatalogBidResponse> Bids { get; init; } = [];

    /// <summary>Bids whose vendor commodity has no active mapping — these won't reach the Bid Sheet yet.</summary>
    public int UnmappedBidCount { get; init; }
}

/// <summary>One publishable bid from the catalog.</summary>
public record BarchartCatalogBidResponse
{
    /// <summary>Scoular commodity code, or null when the vendor commodity isn't mapped.</summary>
    public string? CommodityCode { get; init; }

    /// <summary>The vendor's own commodity name, always shown so an unmapped row is still identifiable.</summary>
    public string VendorCommodity { get; init; } = string.Empty;

    public int CropYear { get; init; }

    /// <summary>Delivery month, 1-12.</summary>
    public int Month { get; init; }

    public decimal? Price { get; init; }

    /// <summary>When the elevator last updated this bid.</summary>
    public DateTime? QuoteAsOf { get; init; }

    public string Symbol { get; init; } = string.Empty;

    /// <summary>False when no active commodity mapping exists for <see cref="VendorCommodity"/>.</summary>
    public bool IsMapped { get; init; }

    /// <summary>
    /// True for a basis instrument, false for cash. Cash and basis are separate BarChart instruments
    /// with independent quotes for the same commodity/period, so this list carries both as distinct
    /// rows rather than one row with two prices -- a caller picking "the" bid for a period (the map's
    /// catalog-reference comparison) has to filter on this, not just take the first match.
    /// </summary>
    public bool IsBasis { get; init; }
}

/// <summary>Catalog coverage, so the picker can say what it holds instead of just showing nothing.</summary>
public record BarchartCoverageResponse
{
    public int LocationCount { get; init; }
    public DateTime? LastRefreshedUtc { get; init; }
    /// <summary>When prices were last loaded from the vendor; shown on the Bid Sheet as "BarChart bids updated ...".</summary>
    public DateTime? PricesRefreshedUtc { get; init; }

    /// <summary>
    /// Days after the elevator's last update before a fed bid stops being shown as a number: past this
    /// the Bid Sheet prints "--" with the date, and a user may type over it without the feed taking it
    /// back until the elevator posts something newer. Configuration (Barchart:StaleAfterDays), not data.
    /// </summary>
    public int StaleAfterDays { get; init; }

    /// <summary>
    /// Whether the Bid Sheet hides a fed bid older than StaleAfterDays behind "--" and its date. Off
    /// everywhere for now: the number shows and the hover says when it was last updated.
    /// </summary>
    public bool HideStaleBids { get; init; }
    public List<BarchartStateCoverageResponse> States { get; init; } = [];
}

/// <summary>One state's location count.</summary>
public record BarchartStateCoverageResponse
{
    public string State { get; init; } = string.Empty;
    public int LocationCount { get; init; }
}

/// <summary>Result of re-running the feed bridge for a single Bid Sheet location.</summary>
public record BarchartRefreshBidsResponse
{
    public int LocationId { get; init; }

    /// <summary>Bid cells written or removed.</summary>
    public int RowsAffected { get; init; }
}
