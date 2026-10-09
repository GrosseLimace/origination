using System.ComponentModel.DataAnnotations;
using GrainOriginatorPortal.Infrastructure.Data.Entities;

namespace GrainOriginatorPortal.Api.Models.Requests;

public record UpsertProducerDetailsRequest
{
    [StringLength(50)]
    public string? ScoularId { get; init; }

    [Required]
    [StringLength(200)]
    public required string CustomerName { get; init; }

    [Range(0, 10_000_000)]
    public decimal? TotalAcres { get; init; }

    [Range(0, 100_000_000)]
    public decimal? BinCapacity { get; init; }

    [StringLength(200)]
    public string? PrimaryContact { get; init; }

    /// <summary>User-entered phone for the primary contact — a manual override kept alongside the
    /// pulled-in ODS phone (does not replace it).</summary>
    [StringLength(50)]
    public string? PrimaryPhone { get; init; }

    [StringLength(500)]
    public string? Commodities { get; init; }

    [StringLength(1000)]
    public string? LinkedProducerIds { get; init; }

    /// <summary>Per-commodity grain-on-farm rows (bushels on hand + target). Replaces the customer's
    /// existing set on save. Rows with an unknown/blank commodity code are ignored server-side.</summary>
    public IReadOnlyList<GrainOnFarmItemRequest>? GrainOnFarm { get; init; }

    /// <summary>User-entered contacts. Replaces the customer's existing set on save; array order is
    /// the display order. NULL (property absent) means "not provided" — existing contacts are
    /// preserved and the legacy PrimaryContact/PrimaryPhone fields above are used as-sent. When
    /// provided, the legacy fields are ignored and derived from the primary row instead.</summary>
    public IReadOnlyList<ContactItemRequest>? Contacts { get; init; }

    /// <summary>User-entered bin sites, as many as needed (sanity ceiling <see cref="BinSiteRules.MaxPerCustomer"/>). Same
    /// contract as <see cref="Contacts"/>: replaces the existing set on save, array order is the
    /// display order, and NULL (property absent) preserves the existing rows.</summary>
    [MaxLength(BinSiteRules.MaxPerCustomer, ErrorMessage = "A producer can have at most 100 bin sites.")]
    public IReadOnlyList<BinSiteItemRequest>? BinSites { get; init; }
}

/// <summary>One bin site. Only the Name is required (user 2026-10-09); everything else is optional.
/// Coordinates, when given, come as a pair inside the North American box in <see cref="BinSiteRules"/>
/// and are stored at full precision (the profile shortens them for display).</summary>
public record BinSiteItemRequest : IValidatableObject
{
    [Required(AllowEmptyStrings = false, ErrorMessage = "Each bin site needs a name.")]
    [StringLength(BinSiteRules.NameMaxLength)]
    public required string Name { get; init; }

    [Range(BinSiteRules.MinLatitude, BinSiteRules.MaxLatitude,
        ErrorMessage = "Latitude must be between 7 and 84 (north of the equator, in North America).")]
    public decimal? Latitude { get; init; }

    [Range(BinSiteRules.MinLongitude, BinSiteRules.MaxLongitude,
        ErrorMessage = "Longitude must be negative (west), between -180 and -52, for North America.")]
    public decimal? Longitude { get; init; }

    /// <summary>A whitespace-only name passes [Required] (it only rejects ""), and half a coordinate
    /// pair is meaningless — both are rejected here.</summary>
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (string.IsNullOrWhiteSpace(Name))
            yield return new ValidationResult("Each bin site needs a name.", [nameof(Name)]);
        if (Latitude.HasValue != Longitude.HasValue)
            yield return new ValidationResult("Give both latitude and longitude, or neither.",
                [Latitude.HasValue ? nameof(Longitude) : nameof(Latitude)]);
    }

    /// <summary>Storage capacity in bushels, optional. Stored per site only; it does not change the
    /// producer-level BinCapacity.</summary>
    [Range(0, BinSiteRules.MaxCapacity, ErrorMessage = "Bin site capacity must be between 0 and 100,000,000 bushels.")]
    public decimal? Capacity { get; init; }
}

public record ContactItemRequest
{
    [Required]
    [StringLength(200)]
    public required string Name { get; init; }

    [StringLength(50)]
    public string? Phone { get; init; }

    [StringLength(255)]
    [EmailAddress]
    public string? Email { get; init; }

    /// <summary>At most one row should be flagged; the server enforces exactly one (first wins,
    /// defaulting to the first row when none is flagged).</summary>
    public bool IsPrimary { get; init; }
}

public record GrainOnFarmItemRequest
{
    /// <summary>Commodity code (e.g. "YC"). A legacy crop-group name is accepted so an existing
    /// pre-code row round-trips unchanged when the producer is saved. Not [Required] only so a
    /// client cached from before 2026-09-23 can still send <see cref="CommodityGroup"/> instead;
    /// a row carrying neither is dropped by the repository, like any blank row.</summary>
    [StringLength(100)]
    public string? CommodityCode { get; init; }

    /// <summary>DEPRECATED — the pre-2026-09-23 name for <see cref="CommodityCode"/>. Accepted for one
    /// release so a browser tab still running the old SPA mid-deploy neither gets a 400 on save nor
    /// wipes the producer's grain rows (the set is replaced on every upsert). Remove after the next
    /// PROD release.</summary>
    [StringLength(100)]
    public string? CommodityGroup { get; init; }

    /// <summary>The value to persist: the code, else the legacy field.</summary>
    [System.Text.Json.Serialization.JsonIgnore]
    public string EffectiveCommodityCode =>
        !string.IsNullOrWhiteSpace(CommodityCode) ? CommodityCode : CommodityGroup ?? string.Empty;

    [Range(0, 1_000_000_000)]
    public decimal? BushelsOnHand { get; init; }

    /// <summary>How many of the <see cref="BushelsOnHand"/> bushels are already sold. Entered by the
    /// user, not derived from contracts; not checked against the total.</summary>
    [Range(0, 1_000_000_000)]
    public decimal? BushelsSold { get; init; }

    /// <summary>$/bu target price. May be negative (a basis target).</summary>
    [Range(-1_000_000_000, 1_000_000_000)]
    public decimal? TargetBushels { get; init; }

    /// <summary>Last bid for this commodity, entered by the user. May be negative (a basis bid).</summary>
    [Range(-1_000_000_000, 1_000_000_000)]
    public decimal? LastBid { get; init; }

    /// <summary>Free-text grade / quality note (e.g. "4.4%", "TW 58"). Not necessarily numeric.</summary>
    [StringLength(100)]
    public string? Grade { get; init; }
}
