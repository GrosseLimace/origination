using System.ComponentModel.DataAnnotations;

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

    [StringLength(500)]
    public string? Commodities { get; init; }

    [StringLength(1000)]
    public string? LinkedProducerIds { get; init; }

    /// <summary>Per-commodity grain-on-farm rows (bushels on hand + target). Replaces the customer's
    /// existing set on save. Rows with an unknown/blank commodity code are ignored server-side.</summary>
    public IReadOnlyList<GrainOnFarmItemRequest>? GrainOnFarm { get; init; }
}

public record GrainOnFarmItemRequest
{
    [Required]
    [StringLength(100)]
    public required string CommodityGroup { get; init; }

    [Range(0, 1_000_000_000)]
    public decimal? BushelsOnHand { get; init; }

    [Range(0, 1_000_000_000)]
    public decimal? TargetBushels { get; init; }

    /// <summary>Free-text grade / quality note (e.g. "4.4%", "TW 58"). Not necessarily numeric.</summary>
    [StringLength(100)]
    public string? Grade { get; init; }
}
