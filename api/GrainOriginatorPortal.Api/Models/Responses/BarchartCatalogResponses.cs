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
}

/// <summary>Catalog coverage, so the picker can say what it holds instead of just showing nothing.</summary>
public record BarchartCoverageResponse
{
    public int LocationCount { get; init; }
    public DateTime? LastRefreshedUtc { get; init; }
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
