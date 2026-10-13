namespace GrainOriginatorPortal.Api.Models.Responses;

/// <summary>Wire shape for user-entered producer details. Entity-shaped (Decision 1) minus the
/// JSON-ignored Customer navigation; CreatedBy/ModifiedBy are resolved to display names.</summary>
public record ProducerDetailsResponse
{
    public int Id { get; init; }
    public long CustomerId { get; init; }
    public string? ScoularId { get; init; }
    public string CustomerName { get; init; } = string.Empty;
    public decimal? TotalAcres { get; init; }
    /// <summary>When this producer's bin sites or grain on farm last changed (UTC); null if never.</summary>
    public DateTime? BinSitesModifiedAt { get; init; }
    public string? PrimaryContact { get; init; }
    public string? PrimaryPhone { get; init; }
    public string? Commodities { get; init; }
    public string? LinkedProducerIds { get; init; }
    public string CreatedBy { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
    public string? ModifiedBy { get; init; }
    public DateTime? ModifiedAt { get; init; }

    /// <summary>Per-commodity grain-on-farm breakdown (bushels on hand + target).</summary>
    public IReadOnlyList<GrainOnFarmItemResponse> GrainOnFarm { get; init; } = [];

    /// <summary>User-entered contacts, primary first. PrimaryContact/PrimaryPhone above are
    /// derived from the primary row (kept for backward compatibility).</summary>
    public IReadOnlyList<ContactItemResponse> Contacts { get; init; } = [];

    /// <summary>User-entered bin sites in display order.</summary>
    public IReadOnlyList<BinSiteItemResponse> BinSites { get; init; } = [];
}

public record BinSiteItemResponse
{
    /// <summary>Stable across saves; grain-on-farm rows point at their site with it.</summary>
    public Guid SiteKey { get; init; }
    public string? Name { get; init; }
    public decimal? Latitude { get; init; }
    public decimal? Longitude { get; init; }
    public decimal? Capacity { get; init; }
    public int SortOrder { get; init; }
}

public record ContactItemResponse
{
    public string Name { get; init; } = string.Empty;
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public bool IsPrimary { get; init; }
    public int SortOrder { get; init; }
}

public record GrainOnFarmItemResponse
{
    /// <summary>The bin site this grain is stored at (<see cref="BinSiteItemResponse.SiteKey"/>);
    /// null on rows saved before sites were linked.</summary>
    public Guid? BinSiteKey { get; init; }
    /// <summary>That site's name, for display.</summary>
    public string? BinSiteName { get; init; }
    /// <summary>Commodity code, or a legacy crop-group name on rows saved before codes.</summary>
    public string CommodityCode { get; init; } = string.Empty;
    public decimal? BushelsOnHand { get; init; }
    public decimal? BushelsSold { get; init; }
    public decimal? TargetBushels { get; init; }
    public decimal? LastBid { get; init; }
    public string? Grade { get; init; }
}
